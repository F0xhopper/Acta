/**
 * The opportunity map: how many good leads (clearing every gate in config/pick.yaml but reach) each trade-in-area search should find, learned from
 * every lead found so far. Pure, so it can be tested and explained.
 *
 * A search's expected rate is the overall rate, times how good its trade is, times how good its area is, each
 * pulled towards average until there is enough evidence (`prior_strength` leads for a trade, `area_prior_strength`
 * for an area). A search that has run has its
 * own record, pulled towards that prediction the same way. Trades and areas with little evidence get an
 * exploration bonus, so new ground gets sampled instead of re-running the one thing known to work. Re-running a
 * search mostly finds businesses already known, so it counts for `rerun_value` of a fresh one.
 */
export interface Observation { categoryKey: string; area: string; found: number; good: number }
export interface CellInput {
  query: string; trade: string; categoryKey: string; area: string; variants: boolean;
  runs: number; lastRunAt: string | null; retired: boolean;
}
export interface Ranking { prior_strength: number; area_prior_strength: number; explore: number; rerun_value: number }
export interface RankedCell extends CellInput {
  rate: number;      // expected good leads per lead found, 0 to 1
  bonus: number;     // exploration bonus, same units
  value: number;     // what the planner sorts by: (rate + bonus), discounted for a re-run
  why: string[];     // plain-English reasons
}

interface Tally { found: number; good: number }
const add = (m: Map<string, Tally>, k: string, o: Observation) => { const t = m.get(k) ?? { found: 0, good: 0 }; t.found += o.found; t.good += o.good; m.set(k, t); };
const per10 = (x: number) => (x * 10).toFixed(1);

export function rankCells(cells: CellInput[], obs: Observation[], cfg: Ranking): RankedCell[] {
  const k = cfg.prior_strength;
  const ka = cfg.area_prior_strength;
  const byTrade = new Map<string, Tally>();
  const byArea = new Map<string, Tally>();
  const byCell = new Map<string, Tally>();
  let found = 0, good = 0;
  for (const o of obs) {
    add(byTrade, o.categoryKey, o); add(byArea, o.area.toLowerCase(), o); add(byCell, `${o.categoryKey}|${o.area.toLowerCase()}`, o);
    found += o.found; good += o.good;
  }
  // Overall rate, gently pulled towards 15% before there is any data.
  const g = (good + 0.15 * 10) / (found + 10);
  // Trade first, then area as what's left over: an area's factor is its good leads over what its trades would
  // predict, so an area searched for one trade only doesn't take that trade's credit (all of Kings Heath's leads
  // being barbers says a lot about barbers, little about Kings Heath). Both are pulled towards 1 by their prior
  // strength, areas more strongly: what you sell matters more than which suburb.
  const trade = new Map<string, number>();
  for (const [key, t] of byTrade) trade.set(key, (t.good + k * g) / (t.found * g + k * g));
  const expA = new Map<string, number>();
  for (const o of obs) expA.set(o.area.toLowerCase(), (expA.get(o.area.toLowerCase()) ?? 0) + o.found * Math.min(0.95, g * (trade.get(o.categoryKey) ?? 1)));
  const area = new Map<string, number>();
  for (const [key, t] of byArea) area.set(key, (t.good + ka * g) / ((expA.get(key) ?? 0) + ka * g));
  const uncertainty = (t: Tally | undefined, strength: number) => 1 / Math.sqrt(1 + (t?.found ?? 0) / strength);

  return cells.map((c) => {
    const tt = byTrade.get(c.categoryKey);
    const at = byArea.get(c.area.toLowerCase());
    const ct = byCell.get(`${c.categoryKey}|${c.area.toLowerCase()}`);
    const tradeF = trade.get(c.categoryKey) ?? 1;
    const areaF = area.get(c.area.toLowerCase()) ?? 1;
    const prior = Math.min(0.95, g * tradeF * areaF);
    // The search's own record, pulled towards the trade-times-area prediction.
    const rate = ct?.found ? (ct.good + (k / 2) * prior) / (ct.found + k / 2) : prior;
    const bonus = cfg.explore * g * (uncertainty(tt, k) + uncertainty(at, ka)) / 2;
    const fresh = c.runs === 0;
    const value = (rate + bonus) * (fresh ? 1 : cfg.rerun_value);
    const why: string[] = [];
    why.push(tt?.found ? `${c.trade}: ${per10(tt.good / tt.found)} good per 10 across ${tt.found} found` : `${c.trade}: not searched yet`);
    why.push(at?.found ? `${c.area}: ${per10(at.good / at.found)} per 10 across ${at.found}` : `${c.area}: not searched yet`);
    if (ct?.found) why.push(`this search: ${ct.good} good of ${ct.found}`);
    if (!fresh) why.push(`re-run, counts ${Math.round(cfg.rerun_value * 100)}%`);
    if (bonus >= 0.5 * g) why.push('little evidence yet, worth a look');
    return { ...c, rate, bonus, value, why };
  }).sort((a, b) => b.value - a.value || a.query.localeCompare(b.query));
}

/** The headline for a cell: expected good leads per 10 found. */
export const expectedPer10 = (c: { rate: number }) => Math.round(c.rate * 100) / 10;

/** Trade and area league tables, for "where is best" at a glance. */
export function leagues(obs: Observation[]): { trades: (Tally & { key: string; per10: number })[]; areas: (Tally & { key: string; per10: number })[] } {
  const t = new Map<string, Tally>(); const a = new Map<string, Tally>();
  const area = new Map<string, string>();
  for (const o of obs) { add(t, o.categoryKey, o); add(a, o.area.toLowerCase(), o); area.set(o.area.toLowerCase(), o.area); }
  const rows = (m: Map<string, Tally>, label: (k: string) => string) => [...m.entries()].map(([key, v]) => ({ key: label(key), ...v, per10: v.found ? Math.round((100 * v.good) / v.found) / 10 : 0 }))
    .sort((x, y) => y.per10 - x.per10 || y.found - x.found);
  return { trades: rows(t, (k) => k), areas: rows(a, (k) => area.get(k) ?? k) };
}
