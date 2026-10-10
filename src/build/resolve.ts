/**
 * Turn "Fade it", "kings-heath-barber-fade-it" or a brand-new business name into a fully audited lead.
 * The build stage must not depend on a discover run having happened.
 */
import { findCategory, loadCategories, loadScoring } from '../config.js';
import { getFullLead, getLeadBySlug, listLeads, saveAudit, saveScore, upsertLead } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import { auditLead } from '../audit/index.js';
import { closeBrowser } from '../audit/screenshot.js';
import { enrichEntities } from '../discover/entity.js';
import { placeToLead } from '../discover/index.js';
import { resolveCategory, type ParsedQuery } from '../discover/parse-query.js';
import { searchText, type Budget, type PlaceResult } from '../discover/places.js';
import { homeMarket } from '../discover/areas.js';
import { scoreLead } from '../score/score.js';
import { nameSimilarity, slugify } from '../util/slug.js';

const TYPE_TO_CATEGORY: Record<string, string> = {
  barber_shop: 'barber', hair_salon: 'beauty', beauty_salon: 'beauty', nail_salon: 'beauty', hair_care: 'beauty', spa: 'beauty',
  plumber: 'plumber', electrician: 'electrician', roofing_contractor: 'roofer', general_contractor: 'builder', painter: 'decorator',
  moving_company: 'removals', locksmith: 'locksmith', car_repair: 'garage', auto_repair_shop: 'garage', cafe: 'cafe', coffee_shop: 'cafe',
  restaurant: 'restaurant', meal_takeaway: 'takeaway', meal_delivery: 'takeaway', gym: 'personal_trainer', fitness_center: 'personal_trainer',
  real_estate_agency: 'estate_agent', dentist: 'dentist', dental_clinic: 'dentist', accounting: 'accountant', physiotherapist: 'physio',
  florist: 'florist', veterinary_care: 'vet', lawyer: 'solicitor', driving_school: 'driving_school', tattoo_parlor: 'tattoo', photographer: 'photographer',
  child_care_agency: 'childcare', preschool: 'childcare', pet_groomer: 'pet', landscaper: 'landscaper', house_cleaning_service: 'cleaner', tutoring_service: 'tutor',
};

function categoryFor(place: PlaceResult, input: string): string {
  const t = place.primaryType ?? '';
  if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  const byLabel = resolveCategory(place.primaryTypeDisplayName?.text ?? '') ?? resolveCategory(input) ?? resolveCategory((place.types ?? []).join(' ').replace(/_/g, ' '));
  return byLabel?.key ?? 'business';
}

function areaFor(place: PlaceResult): string {
  const comps = place.addressComponents ?? [];
  const pick = (t: string) => comps.find((c) => c.types?.includes(t))?.longText;
  const a = pick('sublocality_level_1') ?? pick('sublocality') ?? pick('neighborhood') ?? pick('locality') ?? pick('postal_town') ?? homeMarket()?.name ?? 'Unknown';
  return a;
}

export interface ResolveOpts { budget: Budget; log?: (m: string) => void; create?: boolean }

export async function resolveLead(input: string, opts: ResolveOpts): Promise<FullLead> {
  const say = opts.log ?? (() => undefined);
  const trimmed = input.trim();
  const bySlug = getLeadBySlug(trimmed) ?? getLeadBySlug(slugify(trimmed));
  if (bySlug) return getFullLead(bySlug.slug)!;

  const candidates = listLeads().map((l) => ({ l, sim: nameSimilarity(l.name, trimmed) })).filter((x) => x.sim >= 0.85)
    .sort((a, b) => b.sim - a.sim || (b.l.review_count ?? 0) - (a.l.review_count ?? 0));
  if (candidates.length) {
    say(`matched "${trimmed}" to existing lead ${candidates[0].l.slug}`);
    return getFullLead(candidates[0].l.slug)!;
  }
  if (opts.create === false) throw new Error(`No lead matches "${trimmed}". Run discover first or allow creation.`);

  say(`"${trimmed}" is not in the database, searching Google Places`);
  // A name alone is looked up in the home market (the first active one in config/areas.yaml); "Name, Town" works anywhere.
  const home = homeMarket();
  const where = /,/.test(trimmed) || !home ? '' : `, ${home.name}`;
  const places = await searchText(`${trimmed}${where}, UK`, { pages: 1, budget: opts.budget, centre: home && where ? { latitude: home.centre[0], longitude: home.centre[1] } : undefined });
  if (!places.length) throw new Error(`Google Places found nothing for "${trimmed}${where}"`);
  const best = places.map((p) => ({ p, sim: nameSimilarity(p.displayName?.text ?? '', trimmed) })).sort((a, b) => b.sim - a.sim)[0];
  if (best.sim < 0.5) throw new Error(`Closest Google match was "${best.p.displayName?.text}", which doesn't look like "${trimmed}". Give the exact business name.`);
  const categoryKey = categoryFor(best.p, trimmed);
  const parsed: ParsedQuery = {
    raw: `build: ${trimmed}`, categoryRaw: findCategory(categoryKey)?.keywords[0] ?? categoryKey.replace(/_/g, ' '), categoryKey,
    category: findCategory(categoryKey) ?? loadCategories().find((c) => c.key === categoryKey), area: areaFor(best.p), market: where ? home : undefined, textQuery: `${trimmed}${where}, UK`,
  };
  const lead = placeToLead(best.p, parsed);
  const { id, inserted } = upsertLead(lead);
  say(`${inserted ? 'created' : 'updated'} lead ${lead.slug} (${best.p.displayName?.text}, ${parsed.area}, ${categoryKey})`);
  const row = getLeadBySlug(lead.slug) ?? listLeads().find((l) => l.id === id)!;
  try {
    const audit = await auditLead(row, { psi: true, screenshots: true });
    saveAudit(audit);
    say(`audited: ${audit.website_status}${audit.lh_perf !== null ? ` perf=${audit.lh_perf}` : ''}`);
  } finally {
    await closeBrowser();
  }
  await enrichEntities({ slug: row.slug });
  const full = getFullLead(row.slug)!;
  saveScore(scoreLead(full, loadScoring()));
  return getFullLead(row.slug)!;
}
