import { describe, expect, it } from 'vitest';
import { leagues, rankCells, type CellInput, type Observation } from '../src/sweep/opportunity.js';
import { planSweep, type SearchState } from '../src/sweep/plan.js';
import { SweepSchema } from '../src/sweep/config.js';

const ranking = { prior_strength: 15, area_prior_strength: 40, explore: 1, rerun_value: 0.3 };
const cell = (categoryKey: string, area: string, over: Partial<CellInput> = {}): CellInput =>
  ({ query: `${categoryKey} in ${area}`, trade: categoryKey, categoryKey, area, variants: false, runs: 0, lastRunAt: null, retired: false, ...over });
const obs: Observation[] = [
  { categoryKey: 'barber', area: 'Kings Heath', found: 55, good: 34 },
  { categoryKey: 'coach', area: 'Birmingham', found: 62, good: 5 },
  { categoryKey: 'plumber', area: 'Erdington', found: 29, good: 4 },
];

describe('rankCells', () => {
  it('puts a proven trade in a new area first, then new trades, then a proven-poor trade', () => {
    const r = rankCells([cell('coach', 'Moseley'), cell('florist', 'Moseley'), cell('barber', 'Moseley')], obs, ranking);
    expect(r.map((c) => c.categoryKey)).toEqual(['barber', 'florist', 'coach']);
    expect(r[0].why[0]).toMatch(/6\.2 good per 10 across 55/);
    expect(r[1].why.join(' ')).toMatch(/not searched yet/);
  });
  it('does not credit an area with the trade that happened to be searched there', () => {
    // Every Kings Heath lead is a barber: a new trade in Kings Heath should look ordinary, not like barbers.
    const [kh] = rankCells([cell('florist', 'Kings Heath')], obs, ranking);
    const [barber] = rankCells([cell('barber', 'Moseley')], obs, ranking);
    expect(kh.rate).toBeLessThan(barber.rate / 1.5);
  });
  it("discounts a re-run and uses the search's own record", () => {
    const [fresh] = rankCells([cell('barber', 'Moseley')], obs, ranking);
    const [rerun] = rankCells([cell('barber', 'Kings Heath', { runs: 1 })], obs, ranking);
    expect(rerun.value).toBeLessThan(fresh.value / 2);
    expect(rerun.why).toContain('this search: 34 good of 55');
  });
  it('explores less when told to', () => {
    const [a] = rankCells([cell('florist', 'Moseley')], obs, ranking);
    const [b] = rankCells([cell('florist', 'Moseley')], obs, { ...ranking, explore: 0 });
    expect(b.bonus).toBe(0);
    expect(a.value).toBeGreaterThan(b.value);
  });
  it('works with no data at all', () => {
    const r = rankCells([cell('barber', 'A'), cell('plumber', 'B')], [], ranking);
    expect(r[0].rate).toBeCloseTo(0.15, 2);
  });
});

describe('leagues', () => {
  it('ranks trades and areas by good leads per 10', () => {
    const l = leagues(obs);
    expect(l.trades[0]).toMatchObject({ key: 'barber', per10: 6.2, found: 55 });
    expect(l.areas.map((a) => a.key)).toEqual(['Kings Heath', 'Erdington', 'Birmingham']);
  });
});

describe('planSweep with ranked searches', () => {
  const cfg = SweepSchema.parse({ budget: 8, pages: 2 });
  const st = (query: string, trade: string, area: string, value: number): SearchState =>
    ({ query, trade, area, variants: false, lastRunAt: null, runs: 0, yield: null, retired: false, value });
  it('takes the best first but spreads one run across trades and areas', () => {
    const plan = planSweep([
      st('barbers in A', 'barbers', 'A', 0.5), st('barbers in B', 'barbers', 'B', 0.49), st('barbers in C', 'barbers', 'C', 0.48),
      st('cafes in A', 'cafes', 'A', 0.3), st('florists in D', 'florists', 'D', 0.28),
    ], cfg);
    expect(plan.run.map((r) => r.query)).toEqual(['barbers in A', 'barbers in B', 'florists in D', 'cafes in A']);
    expect(plan.estimatedRequests).toBe(8);
  });
});
