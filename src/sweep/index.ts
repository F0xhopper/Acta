import { discover } from '../discover/index.js';
import { expandAreas } from '../discover/areas.js';
import { parseQuery } from '../discover/parse-query.js';
import type { Budget } from '../discover/places.js';
import { BudgetExceeded } from '../discover/places.js';
import { finishRun, startRun } from '../db/queries.js';
import { log } from '../util/log.js';
import { loadSweep, type SweepConfig } from './config.js';
import { planSweep, retirement, type SearchState, type SweepPlan } from './plan.js';
import { allSearches, ensureSearch, getSearch, markSearchRun, queryYields, setSearchYield } from './queries.js';

/** Every query the config describes, registered in the searches table, with its current state. */
export function sweepStates(cfg: SweepConfig = loadSweep()): SearchState[] {
  const states: SearchState[] = [];
  for (const s of cfg.searches) {
    for (const q of expandAreas(s.trade, s.areas)) {
      const parsed = parseQuery(q);
      ensureSearch(parsed.raw, s.trade, parsed.area, s.variants);
      const row = getSearch(parsed.raw)!;
      states.push({ query: row.query, trade: row.trade, area: row.area, variants: !!row.variants, lastRunAt: row.last_run_at, runs: row.runs, yield: row.yield, retired: !!row.retired });
    }
  }
  return states;
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
