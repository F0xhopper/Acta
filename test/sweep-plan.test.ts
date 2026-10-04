import { describe, expect, it } from 'vitest';
import { planSweep, retirement, type SearchState } from '../src/sweep/plan.js';
import { SweepSchema } from '../src/sweep/config.js';

const cfg = SweepSchema.parse({ budget: 10, pages: 2, searches: [{ trade: 'x', areas: 'y' }] });
const s = (over: Partial<SearchState>): SearchState => ({ query: 'q', trade: 't', area: 'a', variants: false, lastRunAt: null, runs: 0, yield: null, retired: false, ...over });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('planSweep', () => {
  it('runs never-run searches first, then by yield, within budget', () => {
    const plan = planSweep([
      s({ query: 'good', runs: 2, yield: 5, lastRunAt: daysAgo(50) }),
      s({ query: 'fresh', runs: 0 }),
      s({ query: 'meh', runs: 1, yield: 1.5, lastRunAt: daysAgo(60) }),
      s({ query: 'variants', runs: 0, variants: true }),   // costs 6
    ], cfg);
    expect(plan.run.map((r) => r.query)).toEqual(['fresh', 'variants', 'good']);
    expect(plan.estimatedRequests).toBe(10);
    expect(plan.skipped.find((x) => x.query === 'meh')?.why).toMatch(/budget/);
  });
  it('interleaves fresh searches across trades', () => {
    const plan = planSweep([
      s({ query: 'barbers in A', trade: 'barbers' }), s({ query: 'barbers in B', trade: 'barbers' }), s({ query: 'barbers in C', trade: 'barbers' }),
      s({ query: 'plumbers in A', trade: 'plumbers' }), s({ query: 'plumbers in B', trade: 'plumbers' }),
    ], { ...cfg, budget: 8 });
    expect(plan.run.map((r) => r.query)).toEqual(['barbers in A', 'plumbers in A', 'barbers in B', 'plumbers in B']);
  });
  it('skips retired and recently run searches with reasons', () => {
    const plan = planSweep([s({ query: 'r', retired: true, runs: 3 }), s({ query: 'recent', runs: 1, lastRunAt: daysAgo(3) })], cfg);
    expect(plan.run).toHaveLength(0);
    expect(plan.skipped.map((x) => x.why)).toEqual([expect.stringMatching(/retired/), expect.stringMatching(/3 days ago/)]);
  });
});

describe('retirement', () => {
  it('retires after two low-yield runs and resets on a good one', () => {
    expect(retirement(0.5, 0, 1, cfg)).toMatchObject({ lowRuns: 1, retired: false });
    expect(retirement(0.5, 1, 2, cfg)).toMatchObject({ lowRuns: 2, retired: true });
    expect(retirement(4, 1, 2, cfg)).toMatchObject({ lowRuns: 0, retired: false });
    expect(retirement(null, 0, 0, cfg).retired).toBe(false);
  });
});
