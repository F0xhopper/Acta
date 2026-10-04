import type { SweepConfig } from './config.js';

export interface SearchState {
  query: string; trade: string; area: string; variants: boolean;
  lastRunAt: string | null; runs: number; yield: number | null; retired: boolean;
}
export interface SweepPlan { run: (SearchState & { cost: number })[]; skipped: { query: string; why: string }[]; estimatedRequests: number; budget: number }

/** Requests a query will cost: pages per text search, and the category's alternative terms roughly triple it. */
export const queryCost = (s: SearchState, pages: number) => pages * (s.variants ? 3 : 1);

/**
 * Which searches run this week. Never-run first (coverage grows), then by yield, best first.
 * Retired searches and ones run recently are skipped. Stops when the request budget is spent.
 */
export function planSweep(states: SearchState[], cfg: SweepConfig, now = new Date()): SweepPlan {
  const revisitMs = cfg.rotation.revisit_days * 86_400_000;
  const skipped: SweepPlan['skipped'] = [];
  const due = states.filter((s) => {
    if (s.retired) { skipped.push({ query: s.query, why: 'retired (low yield twice)' }); return false; }
    if (s.lastRunAt && now.getTime() - new Date(s.lastRunAt).getTime() < revisitMs) {
      skipped.push({ query: s.query, why: `ran ${Math.round((now.getTime() - new Date(s.lastRunAt).getTime()) / 86_400_000)} days ago` });
      return false;
    }
    return true;
  });
  // Fresh searches interleave across trades, so one week's budget samples several trades instead of one trade everywhere.
  const fresh = roundRobin(due.filter((s) => s.runs === 0), (s) => s.trade);
  const known = due.filter((s) => s.runs > 0).sort((a, b) => (b.yield ?? 0) - (a.yield ?? 0));
  const ordered = cfg.rotation.fresh_first ? [...fresh, ...known] : [...known, ...fresh];
  const run: SweepPlan['run'] = [];
  let spent = 0;
  for (const s of ordered) {
    const cost = queryCost(s, cfg.pages);
    if (spent + cost > cfg.budget) { skipped.push({ query: s.query, why: 'over budget this run, next time' }); continue; }
    run.push({ ...s, cost });
    spent += cost;
  }
  return { run, skipped, estimatedRequests: spent, budget: cfg.budget };
}

/** Retirement: two consecutive low-yield runs. A good run resets the count. */
export function retirement(yld: number | null, lowRuns: number, runs: number, cfg: SweepConfig): { lowRuns: number; retired: boolean; reason: string | null } {
  if (yld === null || runs === 0) return { lowRuns, retired: false, reason: null };
  if (yld < cfg.rotation.drop_below) {
    const n = lowRuns + 1;
    return n >= 2 ? { lowRuns: n, retired: true, reason: `yield ${yld.toFixed(1)} per 10 found on ${n} runs` } : { lowRuns: n, retired: false, reason: null };
  }
  return { lowRuns: 0, retired: false, reason: null };
}

export function roundRobin<T>(items: T[], key: (t: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const i of items) { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(i); }
  const out: T[] = [];
  const lists = [...groups.values()];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
