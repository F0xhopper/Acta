import type { DatabaseSync } from 'node:sqlite';
import { openDb } from './index.js';
import { isoNow } from '../util/dates.js';
import type { AuditRow, CompaniesHouseRow, FullLead, LeadInput, LeadRow, PipelineRow, PipelineStatus, ScoreRow } from './types.js';

const d = (): DatabaseSync => openDb();

// ---------- leads ----------

const LISTING_COLS = ['name', 'address', 'postcode', 'outward_code', 'lat', 'lng', 'phone_e164', 'website_url', 'google_maps_url', 'rating', 'review_count',
  'business_status', 'primary_type', 'types_json', 'opening_hours_json', 'raw_json', 'type_label', 'editorial_summary', 'reviews_json', 'last_review_at', 'photo_count'] as const;

export function upsertLead(input: LeadInput): { id: number; inserted: boolean } {
  const now = isoNow();
  const rec = input as unknown as Record<string, unknown>;
  const val = (c: string) => (rec[c] ?? null) as never;
  const existing = d().prepare('SELECT id FROM leads WHERE place_id = ?').get(input.place_id) as { id: number } | undefined;
  if (existing) {
    d().prepare(`UPDATE leads SET ${LISTING_COLS.map((c) => `${c}=?`).join(', ')}, last_seen_at=? WHERE id=?`)
      .run(...LISTING_COLS.map(val), now as never, existing.id as never);
    return { id: existing.id, inserted: false };
  }
  let slug = input.slug;
  let i = 2;
  while (d().prepare('SELECT 1 FROM leads WHERE slug = ?').get(slug)) slug = `${input.slug}-${i++}`;
  const cols = ['slug', 'place_id', 'category_key', 'category_raw', 'area', 'source_query', ...LISTING_COLS, 'discovered_at', 'last_seen_at'];
  const values = cols.map((c) => (c === 'slug' ? slug : c === 'discovered_at' || c === 'last_seen_at' ? now : val(c)) as never);
  const res = d().prepare(`INSERT INTO leads (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values);
  const id = Number(res.lastInsertRowid);
  d().prepare('INSERT INTO pipeline (lead_id, status, updated_at) VALUES (?, ?, ?)').run(id, 'new', now);
  return { id, inserted: true };
}

export function getLeadBySlug(slug: string): LeadRow | undefined {
  return d().prepare('SELECT * FROM leads WHERE slug = ?').get(slug) as LeadRow | undefined;
}

export function getLeadById(id: number): LeadRow | undefined {
  return d().prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
}

export function leadByPhone(phone: string): LeadRow | undefined {
  return d().prepare('SELECT * FROM leads WHERE phone_e164 = ? LIMIT 1').get(phone) as LeadRow | undefined;
}

export function listLeads(opts: { query?: string; slug?: string } = {}): LeadRow[] {
  if (opts.slug) return d().prepare('SELECT * FROM leads WHERE slug = ?').all(opts.slug) as unknown as LeadRow[];
  if (opts.query) return d().prepare('SELECT * FROM leads WHERE source_query = ? ORDER BY id').all(opts.query) as unknown as LeadRow[];
  return d().prepare('SELECT * FROM leads ORDER BY id').all() as unknown as LeadRow[];
}

export function markChains(): number {
  // Any phone shared by 3+ leads at different addresses, or any final_domain shared by 3+ leads.
  const now = isoNow();
  const byPhone = d().prepare(`SELECT phone_e164 FROM leads WHERE phone_e164 IS NOT NULL GROUP BY phone_e164 HAVING COUNT(DISTINCT address) >= 3`).all() as { phone_e164: string }[];
  const byDomain = d().prepare(`SELECT a.final_domain FROM audits a JOIN leads l ON l.id = a.lead_id WHERE a.final_domain IS NOT NULL AND a.website_status = 'live' GROUP BY a.final_domain HAVING COUNT(DISTINCT l.address) >= 3`).all() as { final_domain: string }[];
  let n = 0;
  for (const r of byPhone) n += Number(d().prepare('UPDATE leads SET is_chain = 1, last_seen_at = ? WHERE phone_e164 = ? AND is_chain = 0').run(now, r.phone_e164).changes);
  for (const r of byDomain) n += Number(d().prepare('UPDATE leads SET is_chain = 1, last_seen_at = ? WHERE is_chain = 0 AND id IN (SELECT lead_id FROM audits WHERE final_domain = ?)').run(now, r.final_domain).changes);
  return n;
}

export function setChain(id: number, isChain: boolean) {
  d().prepare('UPDATE leads SET is_chain = ? WHERE id = ?').run(isChain ? 1 : 0, id);
}

export function setCategoryForQuery(query: string, categoryKey: string): number {
  return Number(d().prepare('UPDATE leads SET category_key = ? WHERE source_query = ?').run(categoryKey, query).changes);
}

export function setSiteDescription(leadId: number, description: string | null) {
  d().prepare('UPDATE audits SET site_description = ? WHERE lead_id = ?').run(description, leadId);
}

// ---------- audits ----------

export function getAudit(leadId: number): AuditRow | undefined {
  return d().prepare('SELECT * FROM audits WHERE lead_id = ?').get(leadId) as AuditRow | undefined;
}

export function saveAudit(a: AuditRow) {
  const cols = Object.keys(a);
  const placeholders = cols.map(() => '?').join(',');
  const updates = cols.filter((c) => c !== 'lead_id').map((c) => `${c}=excluded.${c}`).join(',');
  d().prepare(`INSERT INTO audits (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(lead_id) DO UPDATE SET ${updates}`)
    .run(...cols.map((c) => (a as unknown as Record<string, unknown>)[c] as never));
}

export function leadsNeedingAudit(opts: { query?: string; slug?: string; force?: boolean; freshDays: number }): LeadRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.slug) { where.push('l.slug = ?'); params.push(opts.slug); }
  if (opts.query) { where.push('l.source_query = ?'); params.push(opts.query); }
  if (!opts.force) {
    // Live sites change often and are cheap to re-check. Dead, broken and missing sites are re-checked monthly:
    // a fixed site is a cooled lead, a newly dead one is a hot lead.
    where.push(`(a.lead_id IS NULL OR a.audited_at < CASE WHEN a.website_status = 'live' THEN ? ELSE ? END)`);
    params.push(new Date(Date.now() - opts.freshDays * 86_400_000).toISOString());
    params.push(new Date(Date.now() - Math.max(opts.freshDays, 30) * 86_400_000).toISOString());
  }
  const sql = `SELECT l.* FROM leads l LEFT JOIN audits a ON a.lead_id = l.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id`;
  return d().prepare(sql).all(...(params as never[])) as unknown as LeadRow[];
}

export function recentAuditForDomain(domain: string, freshDays: number): AuditRow | undefined {
  return d().prepare(`SELECT * FROM audits WHERE final_domain = ? AND audited_at >= ? AND lh_perf IS NOT NULL ORDER BY audited_at DESC LIMIT 1`)
    .get(domain, new Date(Date.now() - freshDays * 86_400_000).toISOString()) as AuditRow | undefined;
}

// ---------- companies house ----------

export function getCompaniesHouse(leadId: number): CompaniesHouseRow | undefined {
  return d().prepare('SELECT * FROM companies_house WHERE lead_id = ?').get(leadId) as CompaniesHouseRow | undefined;
}

export function saveCompaniesHouse(r: CompaniesHouseRow) {
  d().prepare(`INSERT INTO companies_house (lead_id, company_number, company_name, company_status, company_type, registered_postcode, sic_codes_json, match_confidence, ltd_hint_from_site, matched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET company_number=excluded.company_number, company_name=excluded.company_name,
    company_status=excluded.company_status, company_type=excluded.company_type, registered_postcode=excluded.registered_postcode,
    sic_codes_json=excluded.sic_codes_json, match_confidence=excluded.match_confidence, ltd_hint_from_site=excluded.ltd_hint_from_site, matched_at=excluded.matched_at`)
    .run(r.lead_id, r.company_number, r.company_name, r.company_status, r.company_type, r.registered_postcode, r.sic_codes_json, r.match_confidence, r.ltd_hint_from_site, r.matched_at);
}

export function leadsNeedingCompaniesHouse(opts: { query?: string; slug?: string; force?: boolean }): LeadRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.slug) { where.push('l.slug = ?'); params.push(opts.slug); }
  if (opts.query) { where.push('l.source_query = ?'); params.push(opts.query); }
  if (!opts.force) where.push('c.lead_id IS NULL');
  const sql = `SELECT l.* FROM leads l LEFT JOIN companies_house c ON c.lead_id = l.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id`;
  return d().prepare(sql).all(...(params as never[])) as unknown as LeadRow[];
}

// ---------- scores ----------

export function saveScore(s: ScoreRow) {
  d().prepare(`INSERT INTO scores (lead_id, scored_at, opportunity, viability, total, tier, channel, reasons_json, excluded_reason)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET scored_at=excluded.scored_at, opportunity=excluded.opportunity,
    viability=excluded.viability, total=excluded.total, tier=excluded.tier, channel=excluded.channel, reasons_json=excluded.reasons_json, excluded_reason=excluded.excluded_reason`)
    .run(s.lead_id, s.scored_at, s.opportunity, s.viability, s.total, s.tier, s.channel, s.reasons_json, s.excluded_reason);
}

export function getFullLead(slug: string): FullLead | undefined {
  const lead = getLeadBySlug(slug);
  if (!lead) return undefined;
  return {
    lead,
    audit: getAudit(lead.id) ?? null,
    ch: getCompaniesHouse(lead.id) ?? null,
    score: (d().prepare('SELECT * FROM scores WHERE lead_id = ?').get(lead.id) as ScoreRow | undefined) ?? null,
    pipeline: d().prepare('SELECT * FROM pipeline WHERE lead_id = ?').get(lead.id) as unknown as PipelineRow,
  };
}

export function fullLeads(opts: { query?: string; statuses?: PipelineStatus[]; tiers?: string[]; minViability?: number } = {}): FullLead[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.query) { where.push('l.source_query = ?'); params.push(opts.query); }
  if (opts.statuses?.length) { where.push(`p.status IN (${opts.statuses.map(() => '?').join(',')})`); params.push(...opts.statuses); }
  if (opts.tiers?.length) { where.push(`s.tier IN (${opts.tiers.map(() => '?').join(',')})`); params.push(...opts.tiers); }
  if (opts.minViability !== undefined) { where.push('s.viability >= ?'); params.push(opts.minViability); }
  const sql = `SELECT l.slug FROM leads l JOIN pipeline p ON p.lead_id = l.id LEFT JOIN scores s ON s.lead_id = l.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE s.tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, s.total DESC, l.review_count DESC`;
  const slugs = d().prepare(sql).all(...(params as never[])) as { slug: string }[];
  return slugs.map((r) => getFullLead(r.slug)!).filter(Boolean);
}

// ---------- pipeline / crm ----------

export function setStatus(slug: string, status: PipelineStatus, note?: string): boolean {
  const lead = getLeadBySlug(slug);
  if (!lead) return false;
  const now = isoNow();
  const touched = ['contacted', 'followup_1', 'followup_2', 'replied'].includes(status);
  d().prepare(`UPDATE pipeline SET status = ?, last_touch_at = CASE WHEN ? THEN ? ELSE last_touch_at END,
    contacted_at = CASE WHEN ? = 'contacted' AND contacted_at IS NULL THEN ? ELSE contacted_at END,
    notes = CASE WHEN ? IS NULL THEN notes ELSE COALESCE(notes || char(10), '') || ? END, updated_at = ? WHERE lead_id = ?`)
    .run(status, touched ? 1 : 0, now, status, now, note ?? null, note ? `${now.slice(0, 10)}: ${note}` : null, now, lead.id);
  return true;
}

export function addSuppression(kind: 'phone' | 'domain' | 'place_id', value: string, reason: string) {
  d().prepare('INSERT OR IGNORE INTO suppression (kind, value, reason, added_at) VALUES (?,?,?,?)').run(kind, value, reason, isoNow());
}

export function isSuppressed(lead: LeadRow, finalDomain?: string | null): boolean {
  const q = d().prepare('SELECT 1 FROM suppression WHERE kind = ? AND value = ?');
  if (q.get('place_id', lead.place_id)) return true;
  if (lead.phone_e164 && q.get('phone', lead.phone_e164)) return true;
  if (finalDomain && q.get('domain', finalDomain)) return true;
  return false;
}

// ---------- runs ----------

export function startRun(query: string | null): number {
  return Number(d().prepare('INSERT INTO runs (query, started_at) VALUES (?, ?)').run(query, isoNow()).lastInsertRowid);
}

export function bumpRun(id: number, field: 'places_requests' | 'psi_requests' | 'ch_requests', by = 1) {
  d().prepare(`UPDATE runs SET ${field} = ${field} + ? WHERE id = ?`).run(by, id);
}

export function finishRun(id: number) {
  d().prepare('UPDATE runs SET finished_at = ? WHERE id = ?').run(isoNow(), id);
}

export function getRun(id: number) {
  return d().prepare('SELECT * FROM runs WHERE id = ?').get(id) as { id: number; query: string | null; places_requests: number; psi_requests: number; ch_requests: number } | undefined;
}

// ---------- stats ----------

export function stats(query?: string) {
  const w = query ? 'WHERE l.source_query = ?' : '';
  const p = query ? [query] : [];
  const one = (sql: string) => (d().prepare(sql).get(...(p as never[])) as { n: number }).n;
  const rows = (sql: string) => d().prepare(sql).all(...(p as never[])) as { k: string; n: number }[];
  return {
    leads: one(`SELECT COUNT(*) n FROM leads l ${w}`),
    audited: one(`SELECT COUNT(*) n FROM leads l JOIN audits a ON a.lead_id = l.id ${w}`),
    scored: one(`SELECT COUNT(*) n FROM leads l JOIN scores s ON s.lead_id = l.id ${w}`),
    chains: one(`SELECT COUNT(*) n FROM leads l ${w ? w + ' AND' : 'WHERE'} l.is_chain = 1`),
    byStatus: rows(`SELECT a.website_status k, COUNT(*) n FROM leads l JOIN audits a ON a.lead_id = l.id ${w} GROUP BY a.website_status ORDER BY n DESC`),
    byTier: rows(`SELECT s.tier k, COUNT(*) n FROM leads l JOIN scores s ON s.lead_id = l.id ${w} GROUP BY s.tier ORDER BY s.tier`),
    byPipeline: rows(`SELECT p.status k, COUNT(*) n FROM leads l JOIN pipeline p ON p.lead_id = l.id ${w} GROUP BY p.status ORDER BY n DESC`),
    byEntity: rows(`SELECT COALESCE(c.match_confidence, 'unchecked') k, COUNT(*) n FROM leads l LEFT JOIN companies_house c ON c.lead_id = l.id ${w} GROUP BY k ORDER BY n DESC`),
    queries: (d().prepare('SELECT source_query k, COUNT(*) n FROM leads GROUP BY source_query ORDER BY n DESC').all() as { k: string; n: number }[]),
  };
}
