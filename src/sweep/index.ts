import { discover } from '../discover/index.js';
import { expandAreas, loadAreaGroups } from '../discover/areas.js';
import { categoryAreas, categoryQuery, loadCategories } from '../config.js';
import { parseQuery } from '../discover/parse-query.js';
import type { Budget } from '../discover/places.js';
import { BudgetExceeded } from '../discover/places.js';
import { finishRun, startRun } from '../db/queries.js';
import { log } from '../util/log.js';
import { loadSweep, type SweepConfig } from './config.js';
import { planSweep, retirement, type SearchState, type SweepPlan } from './plan.js';
import { allSearches, ensureSearch, getSearch, markSearchRun, observations, runHistory, queryYields, setSearchYield } from './queries.js';
import { rankCells, type CellInput, type RankedCell } from './opportunity.js';

/** Every search the sweep could run: each category across its area group in the active markets (auto), plus the listed searches. */
export function candidateSearches(cfg: SweepConfig = loadSweep()): CellInput[] {
  const specs: { trade: string; areas: string; variants: boolean }[] = [];
  if (cfg.mode === 'auto') {
    const groups = loadAreaGroups();
    for (const c of loadCategories()) {
      if ((cfg.trades !== 'all' && !cfg.trades.includes(c.key)) || cfg.skip_trades.includes(c.key)) continue;
      if (!groups[categoryAreas(c)]) continue;
      specs.push({ trade: categoryQuery(c), areas: categoryAreas(c), variants: cfg.variants.includes(c.key) });
    }
  }
  specs.push(...cfg.searches);
  const out = new Map<string, CellInput>();
  const history = runHistory();
  for (const s of specs) {
    for (const q of expandAreas(s.trade, s.areas)) {
      const parsed = parseQuery(q);
      if (out.has(parsed.raw)) continue;
      const row = getSearch(parsed.raw);
      const h = history.get(parsed.raw.toLowerCase());
      // A search you ran by hand counts as run, so the sweep doesn't treat it as new ground.
      const lastRunAt = [row?.last_run_at, h?.last].filter((x): x is string => !!x).sort().pop() ?? null;
      out.set(parsed.raw, { query: parsed.raw, trade: s.trade, categoryKey: parsed.categoryKey, area: parsed.area, variants: s.variants || !!row?.variants,
        runs: Math.max(row?.runs ?? 0, h?.runs ?? 0), lastRunAt, retired: !!row?.retired });
    }
  }
  return [...out.values()];
}

/** The candidate searches ranked by the opportunity map, best first. */
export function opportunities(cfg: SweepConfig = loadSweep()): RankedCell[] {
  return rankCells(candidateSearches(cfg), observations(), cfg.ranking);
}

/** Every search with its state and value, ready for the planner. */
export function sweepStates(cfg: SweepConfig = loadSweep()): SearchState[] {
  const yields = new Map(allSearches().map((r) => [r.query, r.yield]));
  return opportunities(cfg).map((c) => ({ query: c.query, trade: c.trade, area: c.area, variants: c.variants, lastRunAt: c.lastRunAt, runs: c.runs,
    yield: yields.get(c.query) ?? null, retired: c.retired, value: c.value, rate: c.rate, why: c.why }));
}

export interface SweepResult { plan: SweepPlan; ran: { query: string; found: number; inserted: number }[]; stoppedEarly: string | null }

export async function runSweep(opts: { dryRun?: boolean; budget?: number; cfg?: SweepConfig } = {}): Promise<SweepResult> {
  const cfg = { ...(opts.cfg ?? loadSweep()) };
  if (opts.budget) cfg.budget = opts.budget;
  const plan = planSweep(sweepStates(cfg), cfg);
  log.info(`sweep: ${plan.run.length} searches due (${plan.estimatedRequests}/${plan.budget} requests), ${plan.skipped.length} skipped`);
  const ran: SweepResult['ran'] = [];
  if (opts.dryRun) return { plan, ran, stoppedEarly: null };
  const budget: Budget = { used: 0, max: cfg.budget };
  let stoppedEarly: string | null = null;
  for (const s of plan.run) {
    const runId = startRun(s.query);
    try {
      const r = await discover(s.query, { pages: cfg.pages, budget, runId, variants: s.variants });
      const parsed = parseQuery(s.query);
      ensureSearch(parsed.raw, s.trade, parsed.area, s.variants);
      markSearchRun(s.query);
      ran.push({ query: s.query, found: r.found, inserted: r.inserted });
    } catch (e) {
      if (e instanceof BudgetExceeded) { stoppedEarly = `budget reached before "${s.query}"`; log.warn(`sweep: ${stoppedEarly}`); finishRun(runId); break; }
      log.warn(`sweep: "${s.query}" failed: ${(e as Error).message}`);
    } finally {
      finishRun(runId);
    }
  }
  return { plan, ran, stoppedEarly };
}

/** Recompute yield per search from the database, after scoring, and retire the persistent losers. */
export function updateYields(cfg: SweepConfig = loadSweep()): { updated: number; retired: string[] } {
  const byQuery = new Map(queryYields().map((y) => [y.query, y]));
  const retired: string[] = [];
  let updated = 0;
  for (const s of allSearches()) {
    const y = byQuery.get(s.query);
    if (!y) continue;
    const yld = y.found ? (10 * y.tier_ab) / y.found : null;
    const r = retirement(yld, s.low_runs, s.runs, cfg);
    setSearchYield(s.query, y.found, y.tier_ab, yld, r.lowRuns, r.retired, r.reason);
    if (r.retired && !s.retired) retired.push(s.query);
    updated++;
  }
  return { updated, retired };
}
