/**
 * Suggestions: the leads that pass every gate (src/pick/grade.ts), ranked by grade, for you to pick from; then the
 * near misses, one gate short, each with what's missing (often just an email to find). Nothing is picked for you.
 * Repeats of a trade on one street sink a little each time (`repeat_decay`) rather than being hidden, so the top of
 * the list is varied but nothing good is lost. Anything found in the last few days is marked new.
 */
import { openDb } from '../db/index.js';
import { fullLeads } from '../db/queries.js';
import { hook } from '../report/format.js';
import { reachOf, type ReachLevel } from '../score/reach.js';
import { findCategory } from '../config.js';
import { loadPick, type PickConfig } from './config.js';
import type { Gate, GradePart, Verdict } from './grade.js';
import { outcomeStats } from './queries.js';
import { filterCandidates, type Candidate } from './rules.js';
import { learning } from './trade.js';

export interface Suggestion {
  slug: string; name: string; categoryKey: string; categoryLabel: string; area: string;
  tier: string; score: number; pickScore: number; buildability: number; reasons: string[];
  reach: ReachLevel; hook: string; isNew: boolean; discoveredAt: string;
  verdict: Exclude<Verdict, 'fail'>; grade: number; gates: Gate[]; parts: GradePart[];
}

export function suggestions(opts: { limit?: number; cfg?: PickConfig; nearMisses?: boolean } = {}): Suggestion[] {
  const cfg = opts.cfg ?? loadPick();
  const picked = new Set((openDb().prepare('SELECT lead_id FROM picks').all() as { lead_id: number }[]).map((r) => r.lead_id));
  const { eligible, near } = filterCandidates(fullLeads({ statuses: ['new'] }), cfg, picked, learning(outcomeStats()));
  const passed = spread(eligible, cfg.suggest.repeat_decay).slice(0, opts.limit ?? cfg.suggest.limit);
  const nearly = opts.nearMisses === false ? [] : spread(near, cfg.suggest.repeat_decay).slice(0, cfg.suggest.near_misses);
  const newSince = Date.now() - cfg.suggest.new_days * 86_400_000;
  return [...passed, ...nearly].map((c) => {
    const { lead, score } = c.full;
    return {
      slug: lead.slug, name: lead.name, categoryKey: lead.category_key, categoryLabel: lead.category_key.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase()),
      area: lead.area, tier: score!.tier, score: score!.total, pickScore: c.pickScore, buildability: c.buildability, reasons: c.reasons,
      reach: reachOf(c.full, findCategory(lead.category_key)).level, hook: hook(c.full),
      isNew: new Date(lead.discovered_at).getTime() >= newSince, discoveredAt: lead.discovered_at,
      verdict: c.grade.verdict === 'pass' ? 'pass' : 'near', grade: c.grade.score, gates: c.grade.gates, parts: c.grade.parts,
    };
  });
}

/** Best first, each further lead of the same trade in the same area worth `decay` times less for ordering. */
export function spread(list: Candidate[], decay: number): Candidate[] {
  const left = [...list];
  const seen = new Map<string, number>();
  const out: Candidate[] = [];
  const key = (c: Candidate) => `${c.full.lead.category_key}|${c.full.lead.area}`;
  while (left.length) {
    let best = 0;
    const adj = (c: Candidate) => c.pickScore * decay ** (seen.get(key(c)) ?? 0);
    for (let i = 1; i < left.length; i++) if (adj(left[i]) > adj(left[best])) best = i;
    const c = left.splice(best, 1)[0];
    seen.set(key(c), (seen.get(key(c)) ?? 0) + 1);
    out.push(c);
  }
  return out;
}
