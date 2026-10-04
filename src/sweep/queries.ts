import { openDb } from '../db/index.js';
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
/** Found and tier A+B per source query, across every status, straight from the leads and scores. */
export function queryYields(): { query: string; found: number; tier_ab: number }[] {
  return d().prepare(`SELECT l.source_query query, COUNT(*) found, SUM(CASE WHEN s.tier IN ('A','B') THEN 1 ELSE 0 END) tier_ab
    FROM leads l LEFT JOIN scores s ON s.lead_id = l.id GROUP BY l.source_query`).all() as unknown as { query: string; found: number; tier_ab: number }[];
}
