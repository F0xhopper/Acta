import { loadScoring } from '../config.js';
import { markChains, upsertLead, leadByPhone, bumpRun, setChain } from '../db/queries.js';
import type { LeadInput } from '../db/types.js';
import { normaliseUkPhone } from '../util/phone.js';
import { leadSlug, normaliseName } from '../util/slug.js';
import { isChainName } from '../util/business.js';
import { log } from '../util/log.js';
import { parseQuery, type ParsedQuery } from './parse-query.js';
import { outwardCode, postcodeOf, searchText, type Budget, type PlaceResult } from './places.js';

export interface DiscoverOpts { pages?: number; dryRun?: boolean; anyPostcode?: boolean; runId?: number; budget: Budget; variants?: boolean }
export interface DiscoverResult { parsed: ParsedQuery; found: number; inserted: number; updated: number; skipped: Record<string, number>; chains: number }

/** The main search, plus the category's alternative search terms when --variants is on. Same area, different words, more owner-operators. */
export function textQueries(parsed: ParsedQuery, variants: boolean): string[] {
  const base = [parsed.textQuery];
  if (!variants || !parsed.category?.search_terms.length) return base;
  const where = parsed.textQuery.replace(/^.*? in /, '');
  return [...new Set([...base, ...parsed.category.search_terms.map((t) => `${t} in ${where}`)])];
}

export function placeToLead(place: PlaceResult, parsed: ParsedQuery): LeadInput {
  const postcode = postcodeOf(place);
  const name = place.displayName?.text?.trim() || 'Unknown';
  return {
    slug: leadSlug(parsed.area, parsed.categoryKey, name),
    place_id: place.id,
    name,
    category_key: parsed.categoryKey,
    category_raw: parsed.categoryRaw,
    area: parsed.area,
    source_query: parsed.raw,
    address: place.formattedAddress ?? null,
    postcode,
    outward_code: outwardCode(postcode),
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    phone_e164: normaliseUkPhone(place.internationalPhoneNumber ?? place.nationalPhoneNumber),
    website_url: place.websiteUri ?? null,
    google_maps_url: place.googleMapsUri ?? null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    business_status: place.businessStatus ?? null,
    primary_type: place.primaryType ?? null,
    types_json: place.types ? JSON.stringify(place.types) : null,
    opening_hours_json: place.regularOpeningHours?.weekdayDescriptions ? JSON.stringify(place.regularOpeningHours.weekdayDescriptions) : null,
    raw_json: JSON.stringify({ ...place, reviews: undefined, photos: undefined }),
    type_label: place.primaryTypeDisplayName?.text ?? null,
    editorial_summary: place.editorialSummary?.text ?? null,
    reviews_json: place.reviews?.length ? JSON.stringify(place.reviews.map((r) => ({
      rating: r.rating ?? null,
      text: (r.text?.text ?? '').replace(/\s+/g, ' ').slice(0, 600),
      when: r.relativePublishTimeDescription ?? null,
      at: r.publishTime ?? null,
      author: r.authorAttribution?.displayName ?? null,
    }))) : null,
    last_review_at: place.reviews?.map((r) => r.publishTime ?? '').filter(Boolean).sort().pop() ?? null,
    photo_count: place.photos ? place.photos.length : null,
  };
}

export async function discover(rawQuery: string, opts: DiscoverOpts): Promise<DiscoverResult> {
  const parsed = parseQuery(rawQuery);
  const scoring = loadScoring();
  log.info(`discover: "${parsed.raw}" -> category=${parsed.categoryKey} area=${parsed.area} textQuery="${parsed.textQuery}"`);
  if (!parsed.category) log.warn(`no category in config/categories.yaml matches "${parsed.categoryRaw}". Scoring will use neutral defaults. Add keywords there, or fix existing leads with: pipeline category --query "${parsed.raw}" --set <key>`);
  const places: PlaceResult[] = [];
  for (const tq of textQueries(parsed, !!opts.variants)) {
    if (tq !== parsed.textQuery) log.info(`discover: variant "${tq}"`);
    places.push(...await searchText(tq, {
      pages: opts.pages,
      budget: opts.budget,
      dryRun: opts.dryRun,
      onRequest: () => { if (opts.runId) bumpRun(opts.runId, 'places_requests'); },
    }));
  }
  const result: DiscoverResult = { parsed, found: places.length, inserted: 0, updated: 0, skipped: {}, chains: 0 };
  const skip = (why: string) => { result.skipped[why] = (result.skipped[why] ?? 0) + 1; };
  if (opts.dryRun) return result;

  for (const place of places) {
    if (!place.id) { skip('no_id'); continue; }
    if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') { skip('not_operational'); continue; }
    const lead = placeToLead(place, parsed);
    if (!opts.anyPostcode && !(lead.outward_code && /^B\d/.test(lead.outward_code))) { skip('outside_birmingham'); continue; }
    if (lead.phone_e164) {
      const other = leadByPhone(lead.phone_e164);
      if (other && other.place_id !== lead.place_id && normaliseName(other.name) === normaliseName(lead.name)) { skip('duplicate_phone'); continue; }
    }
    const { id, inserted } = upsertLead(lead);
    if (isChainName(lead.name, scoring)) {
      setChain(id, true);
      result.chains++;
    }
    if (inserted) result.inserted++; else result.updated++;
  }
  result.chains += markChains();
  log.info(`discover: found=${result.found} inserted=${result.inserted} updated=${result.updated} skipped=${JSON.stringify(result.skipped)} chains=${result.chains}`);
  return result;
}
