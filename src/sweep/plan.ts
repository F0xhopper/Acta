import type { SweepConfig } from './config.js';

export interface SearchState {
  query: string; trade: string; area: string; variants: boolean;
  lastRunAt: string | null; runs: number; yield: number | null; retired: boolean;
  /** From the opportunity map: what the search is worth, its expected good leads per lead found, and why. */
  value?: number; rate?: number; why?: string[];
}
export interface SweepPlan { run: (SearchState & { cost: number })[]; skipped: { query: string; why: string }[]; estimatedRequests: number; budget: number }

/** Requests a query will cost: pages per text search, and the category's alternative terms roughly triple it. */
export const queryCost = (s: SearchState, pages: number) => pages * (s.variants ? 3 : 1);

/**
 * Which searches run now. Retired searches and ones run recently are skipped. Stops when the request budget is spent.
 * Ranked searches (with a `value` from the opportunity map) go best first, each further search of the same trade or
 * area worth a little less, so one run samples several trades and streets instead of one trade everywhere.
 * Unranked ones: never-run first (coverage grows), then by yield.
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
  if (due.length && due.every((s) => s.value !== undefined)) return greedy(due, cfg, skipped);
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

function greedy(due: SearchState[], cfg: SweepConfig, skipped: SweepPlan['skipped']): SweepPlan {
  const { same_trade_decay: td, same_area_decay: ad } = cfg.ranking;
  const left = [...due];
  const trades = new Map<string, number>();
  const areas = new Map<string, number>();
  const run: SweepPlan['run'] = [];
  let spent = 0;
  while (left.length) {
    const adj = (s: SearchState) => s.value! * td ** (trades.get(s.trade) ?? 0) * ad ** (areas.get(s.area.toLowerCase()) ?? 0);
    let best = 0;
    for (let i = 1; i < left.length; i++) if (adj(left[i]) > adj(left[best])) best = i;
    const s = left.splice(best, 1)[0];
    const cost = queryCost(s, cfg.pages);
    if (spent + cost > cfg.budget) { skipped.push({ query: s.query, why: 'over budget this run, next time' }); continue; }
    run.push({ ...s, cost });
    spent += cost;
    trades.set(s.trade, (trades.get(s.trade) ?? 0) + 1);
    areas.set(s.area.toLowerCase(), (areas.get(s.area.toLowerCase()) ?? 0) + 1);
  }
  return { run, skipped, estimatedRequests: spent, budget: cfg.budget };
}
