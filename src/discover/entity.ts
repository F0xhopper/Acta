import { findCategory } from '../config.js';
import { bumpRun, getAudit, leadsNeedingCompaniesHouse, saveCompaniesHouse } from '../db/queries.js';
import type { LeadRow } from '../db/types.js';
import { isoNow } from '../util/dates.js';
import { log } from '../util/log.js';
import { getCompanyProfile, searchCompanies } from './companies-house.js';
import { matchCompany, promoteBySic } from './match.js';

/** `medium`: look again only at medium matches, which SIC codes can now settle. */
export interface EntityOpts { query?: string; slug?: string; force?: boolean; medium?: boolean; runId?: number; dryRun?: boolean }

/** Classify each lead as a limited company (high-confidence Companies House match) or unknown. */
export async function enrichEntities(opts: EntityOpts): Promise<{ checked: number; high: number; medium: number; errors: number }> {
  const leads = leadsNeedingCompaniesHouse(opts);
  const out = { checked: 0, high: 0, medium: 0, errors: 0 };
  if (opts.dryRun) { log.info(`[dry-run] would check ${leads.length} leads against Companies House`); return out; }
  const onRequest = () => { if (opts.runId) bumpRun(opts.runId, 'ch_requests'); };
  for (const lead of leads) {
    try {
      await enrichOne(lead, onRequest);
      out.checked++;
    } catch (e) {
      out.errors++;
      log.warn(`companies house failed for ${lead.slug}: ${(e as Error).message}`);
    }
  }
  return out;
}

async function enrichOne(lead: LeadRow, onRequest: () => void) {
  const audit = getAudit(lead.id);
  const ltdHint = !!audit?.ltd_hint;
  const tradeSic = findCategory(lead.category_key)?.sic ?? [];
  const items = await searchCompanies(lead.name, onRequest);
  let match = matchCompany(lead, items, ltdHint);
  let profile: Awaited<ReturnType<typeof getCompanyProfile>> | null = null;
  // The profile carries the SIC codes and the incorporation date: fetched for a high match, and for a medium one
  // when the trade has SIC codes that could settle it.
  if (match.item && (match.confidence === 'high' || (match.confidence === 'medium' && tradeSic.length))) {
    try { profile = await getCompanyProfile(match.item.company_number, onRequest); } catch (e) { log.debug(`profile fetch failed: ${(e as Error).message}`); }
  }
  match = promoteBySic(match, profile?.sic_codes, tradeSic);
  if (match.via === 'sic') log.info(`${lead.slug}: ${match.item?.title} promoted to a high match, its SIC codes say ${lead.category_key}`);
  saveCompaniesHouse({
    lead_id: lead.id,
    company_number: match.item?.company_number ?? null,
    company_name: match.item?.title ?? null,
    company_status: profile?.company_status ?? match.item?.company_status ?? null,
    company_type: profile?.type ?? match.item?.company_type ?? null,
    registered_postcode: profile?.registered_office_address?.postal_code ?? match.item?.address?.postal_code ?? null,
    sic_codes_json: profile?.sic_codes ? JSON.stringify(profile.sic_codes) : null,
    match_confidence: match.confidence,
    ltd_hint_from_site: ltdHint ? 1 : 0,
    matched_at: isoNow(),
    date_of_creation: profile?.date_of_creation ?? match.item?.date_of_creation ?? null,
  });
  log.debug(`${lead.slug}: CH ${match.confidence} (${match.similarity.toFixed(2)}) ${match.item?.title ?? ''}`);
}
