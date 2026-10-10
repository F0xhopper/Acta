import { findCategory } from '../config.js';
import { openDb } from '../db/index.js';
import { fullLeads } from '../db/queries.js';
import { loadPick } from '../pick/config.js';
import { gradeLead } from '../pick/grade.js';
import { outcomeStats } from '../pick/queries.js';
import { learning, sweepWeight } from '../pick/trade.js';
import { isoNow } from '../util/dates.js';

export interface SearchRow {
  query: string; trade: string; area: string; variants: number; first_run_at: string | null; last_run_at: string | null; runs: number;
  found: number; tier_ab: number; yield: number | null; low_runs: number; retired: number; retired_reason: string | null; updated_at: string;
}
const d = () => openDb();

export function getSearch(query: string): SearchRow | undefined {
  return d().prepare('SELECT * FROM searches WHERE query = ?').get(query) as unknown as SearchRow | undefined;
}
export function allSearches(): SearchRow[] {
  return d().prepare('SELECT * FROM searches ORDER BY yield DESC NULLS LAST, query').all() as unknown as SearchRow[];
}
export function ensureSearch(query: string, trade: string, area: string, variants: boolean) {
  d().prepare('INSERT OR IGNORE INTO searches (query, trade, area, variants, updated_at) VALUES (?,?,?,?,?)').run(query, trade, area, variants ? 1 : 0, isoNow());
}
export function markSearchRun(query: string) {
  const now = isoNow();
  d().prepare('UPDATE searches SET runs = runs + 1, last_run_at = ?, first_run_at = COALESCE(first_run_at, ?), updated_at = ? WHERE query = ?').run(now, now, now, query);
}
export function setSearchYield(query: string, found: number, tierAb: number, yld: number | null, lowRuns: number, retired: boolean, reason: string | null) {
  d().prepare('UPDATE searches SET found = ?, tier_ab = ?, yield = ?, low_runs = ?, retired = ?, retired_reason = ?, updated_at = ? WHERE query = ?')
    .run(found, tierAb, yld, lowRuns, retired ? 1 : 0, reason, isoNow(), query);
}
/**
 * A good lead, for learning which searches to run: it clears every gate in config/pick.yaml except reach (an email
 * is often found after discovery, on their Facebook page or a directory, so a search isn't marked down for that).
 * It counts in proportion to its trade's value (`trade.sweep_full_at`), so the sweep leans towards trades worth
 * building for without dropping the rest. (Stored in the `tier_ab` column, which once counted tier A and B.)
 */
const goodLeads = () => {
  const cfg = loadPick();
  const learn = learning(outcomeStats());
  return fullLeads().map((f) => {
    const g = gradeLead(f, cfg, findCategory(f.lead.category_key), learn);
    return { f, good: g.failed.every((x) => x.key === 'reach') ? Math.round(10 * sweepWeight(g.trade, cfg)) / 10 : 0 };
  });
};
/** Found and good per source query, across every status. */
export function queryYields(): { query: string; found: number; tier_ab: number }[] {
  const m = new Map<string, { query: string; found: number; tier_ab: number }>();
  for (const { f, good } of goodLeads()) {
    const r = m.get(f.lead.source_query) ?? { query: f.lead.source_query, found: 0, tier_ab: 0 };
    r.found++; r.tier_ab += good;
    m.set(f.lead.source_query, r);
  }
  return [...m.values()];
}
/** Found and good per category and area, the evidence the opportunity map learns from. */
export function observations(): { categoryKey: string; area: string; found: number; good: number }[] {
  const m = new Map<string, { categoryKey: string; area: string; found: number; good: number }>();
  for (const { f, good } of goodLeads()) {
    const k = `${f.lead.category_key}|${f.lead.area}`;
    const r = m.get(k) ?? { categoryKey: f.lead.category_key, area: f.lead.area, found: 0, good: 0 };
    r.found++; r.good += good;
    m.set(k, r);
  }
  return [...m.values()];
}
/** Every search run by any route (the sweep, the Leads page, `pipeline run`), by lowercased query: how often and when last. */
export function runHistory(): Map<string, { runs: number; last: string }> {
  const rows = d().prepare('SELECT LOWER(query) q, COUNT(*) n, MAX(started_at) last FROM runs WHERE query IS NOT NULL GROUP BY LOWER(query)').all() as unknown as { q: string; n: number; last: string }[];
  return new Map(rows.map((r) => [r.q, { runs: r.n, last: r.last }]));
}
