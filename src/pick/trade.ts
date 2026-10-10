/**
 * How much a website is worth to a trade. It starts as the guess in config/categories.yaml (`trade_value`) and moves
 * towards what your pitches show: a trade replying more often than your average rises, one that never replies sinks.
 * After `learn_weight` pitches in a trade, its results count as much as the guess. Pure.
 */
import type { Category } from '../config.js';
import type { PickConfig } from './config.js';

export interface TradeOutcome { contacted: number; positive: number }
export interface TradeLearning { outcomes: Map<string, TradeOutcome>; overall: number | null }   // overall: replies or wins per pitch, every trade
export interface TradeValue { prior: number; value: number; contacted: number; positive: number; detail: string }

export const NO_LEARNING: TradeLearning = { outcomes: new Map(), overall: null };

export function learning(stats: { category_key: string; contacted: number; positive: number }[]): TradeLearning {
  const contacted = stats.reduce((a, s) => a + s.contacted, 0);
  return {
    outcomes: new Map(stats.map((s) => [s.category_key, { contacted: s.contacted, positive: s.positive }])),
    overall: contacted ? stats.reduce((a, s) => a + s.positive, 0) / contacted : null,
  };
}

const name = (key: string) => key.replace(/_/g, ' ');

export function tradeValue(category: Category | undefined, learn: TradeLearning, cfg: PickConfig): TradeValue {
  const prior = category?.trade_value ?? 0;
  if (!category) return { prior, value: 0, contacted: 0, positive: 0, detail: 'Not a configured trade' };
  const o = learn.outcomes.get(category.key);
  // Nothing to learn from until this trade has pitches and some trade somewhere has replied.
  if (!o?.contacted || !learn.overall) {
    return { prior, value: prior, contacted: o?.contacted ?? 0, positive: o?.positive ?? 0, detail: `${name(category.key)}: ${prior}${o?.contacted ? `, ${o.contacted} pitched, no replies anywhere yet` : ', not pitched yet'}` };
  }
  const rate = o.positive / o.contacted;
  const shown = Math.max(0, Math.min(100, prior * (rate / learn.overall)));
  const w = o.contacted / (o.contacted + cfg.trade.learn_weight);
  const value = Math.round(prior * (1 - w) + shown * w);
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  return { prior, value, contacted: o.contacted, positive: o.positive,
    detail: `${name(category.key)}: ${value} (guessed ${prior}; ${o.positive} of ${o.contacted} pitches replied, ${pct(rate)} against ${pct(learn.overall)} overall)` };
}

/** How much a lead from this trade counts when the sweep learns which searches to run: fully from `sweep_full_at` up. */
export const sweepWeight = (t: TradeValue, cfg: PickConfig) => Math.max(0, Math.min(1, t.value / cfg.trade.sweep_full_at));
