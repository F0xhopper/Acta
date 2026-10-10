import { findCategory } from '../config.js';
import { contentOf } from '../score/content.js';
import type { FullLead } from '../db/types.js';
import type { PickConfig } from './config.js';
import { gradeLead, missing, type Grade } from './grade.js';
import { NO_LEARNING, type TradeLearning } from './trade.js';

export interface Candidate { full: FullLead; grade: Grade; buildability: number; buildabilityParts: string[]; pickScore: number; reasons: string[] }
export interface Skip { slug: string; name: string; why: string; gates?: string[] }   // gates: the ones it failed
export interface WeekPick { category_key: string; area: string }

/** 0 to 100: how much there is to build a good site from: the content score, with what's there. */
export function buildability(full: FullLead): { score: number; parts: string[] } {
  const c = contentOf(full, findCategory(full.lead.category_key));
  return { score: c.score, parts: c.items.filter((i) => i.have !== 'no').map((i) => `${i.label.toLowerCase()}: ${i.detail}`) };
}

const daysSince = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Number.POSITIVE_INFINITY);

/**
 * The gates (src/pick/grade.ts) over every new lead: the ones that pass, ranked by grade (whose trade part has
 * learned from your pitches); the near misses, one gate short; and every other lead with the reason it was left out.
 * `freshDays` (auto-pick) also skips leads whose audit is older than that.
 */
export function filterCandidates(fulls: FullLead[], cfg: PickConfig, alreadyPicked: Set<number>, learn: TradeLearning = NO_LEARNING, opts: { freshDays?: number } = {}): { eligible: Candidate[]; near: Candidate[]; skipped: Skip[] } {
  const eligible: Candidate[] = [];
  const near: Candidate[] = [];
  const skipped: Skip[] = [];
  for (const full of fulls) {
    const { lead, audit, pipeline } = full;
    const skip = (why: string, gates?: string[]) => skipped.push({ slug: lead.slug, name: lead.name, why, ...(gates ? { gates } : {}) });
    if (pipeline.status !== 'new') { skip(`status ${pipeline.status}`); continue; }
    if (alreadyPicked.has(lead.id)) { skip('already picked'); continue; }
    if (opts.freshDays !== undefined && audit && daysSince(audit.audited_at) > opts.freshDays) { skip(`audit is ${Math.round(daysSince(audit.audited_at))} days old`); continue; }
    const grade = gradeLead(full, cfg, findCategory(lead.category_key), learn);
    const failedGates = grade.failed.map((f) => f.label);
    if (grade.verdict === 'fail') { skip(missing(grade), failedGates); continue; }
    const b = buildability(full);
    const reasons = [`grade ${grade.score}`, ...grade.parts.map((p) => `${p.label} ${p.points}/${p.max}: ${p.detail}`)];
    const c: Candidate = { full, grade, buildability: b.score, buildabilityParts: b.parts, pickScore: grade.score, reasons };
    if (grade.verdict === 'pass') eligible.push(c);
    else { near.push(c); skip(`near miss: ${missing(grade)}`, failedGates); }
  }
  const order = (a: Candidate, b: Candidate) => b.pickScore - a.pickScore || (b.full.lead.review_count ?? 0) - (a.full.lead.review_count ?? 0);
  return { eligible: eligible.sort(order), near: near.sort(order), skipped };
}

/** Caps so previews never compete with each other on one street, and the week stays inside the build budget. */
export function applyDiversity(eligible: Candidate[], cfg: PickConfig, thisWeek: WeekPick[], max: number): { picked: Candidate[]; skipped: Skip[] } {
  const picked: Candidate[] = [];
  const skipped: Skip[] = [];
  const perTradeArea = new Map<string, number>();
  const perAreaWalkIn = new Map<string, number>();
  for (const w of thisWeek) {
    perTradeArea.set(`${w.category_key}|${w.area}`, (perTradeArea.get(`${w.category_key}|${w.area}`) ?? 0) + 1);
    if (findCategory(w.category_key)?.walk_in) perAreaWalkIn.set(w.area, (perAreaWalkIn.get(w.area) ?? 0) + 1);
  }
  const remaining = Math.max(0, Math.min(max, cfg.diversity.max_per_week - thisWeek.length));
  for (const c of eligible) {
    const { lead } = c.full;
    if (picked.length >= remaining) { skipped.push({ slug: lead.slug, name: lead.name, why: `weekly cap of ${cfg.diversity.max_per_week} reached` }); continue; }
    const ta = `${lead.category_key}|${lead.area}`;
    if ((perTradeArea.get(ta) ?? 0) >= cfg.diversity.max_per_trade_area) { skipped.push({ slug: lead.slug, name: lead.name, why: `already ${cfg.diversity.max_per_trade_area} ${lead.category_key} in ${lead.area} this week` }); continue; }
    const walkIn = !!findCategory(lead.category_key)?.walk_in;
    if (walkIn && (perAreaWalkIn.get(lead.area) ?? 0) >= cfg.diversity.max_walk_in_per_area) { skipped.push({ slug: lead.slug, name: lead.name, why: `already a walk-in trade picked in ${lead.area} this week` }); continue; }
    picked.push(c);
    perTradeArea.set(ta, (perTradeArea.get(ta) ?? 0) + 1);
    if (walkIn) perAreaWalkIn.set(lead.area, (perAreaWalkIn.get(lead.area) ?? 0) + 1);
  }
  return { picked, skipped };
}
