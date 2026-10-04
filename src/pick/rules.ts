import { findCategory } from '../config.js';
import type { FullLead } from '../db/types.js';
import type { PickConfig } from './config.js';

export interface Candidate { full: FullLead; buildability: number; buildabilityParts: string[]; pickScore: number; reasons: string[] }
export interface Skip { slug: string; name: string; why: string }
export interface WeekPick { category_key: string; area: string }

/** 0 to 100: how much there is to build a good site from tonight. */
export function buildability(full: FullLead, cfg: PickConfig): { score: number; parts: string[] } {
  const b = cfg.buildability;
  const parts: string[] = [];
  let s = 0;
  const photos = full.lead.photo_count ?? 0;
  if (photos >= 8) { s += b.photos_8; parts.push(`${photos} photos`); }
  else if (photos >= 3) { s += b.photos_3; parts.push(`${photos} photos`); }
  else if (photos >= 1) { s += b.photos_1; parts.push(`${photos} photo${photos > 1 ? 's' : ''}`); }
  else parts.push(full.lead.photo_count === null ? 'photos unknown' : 'no photos');
  if (full.audit?.website_status === 'live') { s += b.has_live_site; parts.push('live site to take brand from'); }
  if (full.lead.editorial_summary || full.audit?.site_description) { s += b.has_description; parts.push('description'); }
  let withText = 0;
  try { withText = ((JSON.parse(full.lead.reviews_json ?? '[]') as { text?: string }[]).filter((r) => (r.text ?? '').length >= 40)).length; } catch { /* none */ }
  if (withText >= 3) { s += b.reviews_with_text_3; parts.push(`${withText} reviews with text`); }
  if (full.lead.opening_hours_json) { s += b.hours_listed; parts.push('hours'); }
  return { score: Math.min(100, s), parts };
}

const daysSince = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Number.POSITIVE_INFINITY);

/** Hard filters. Every rejection has a reason the operator can read. */
export function filterCandidates(fulls: FullLead[], cfg: PickConfig, alreadyPicked: Set<number>, multipliers: Map<string, number> = new Map()): { eligible: Candidate[]; skipped: Skip[] } {
  const f = cfg.filters;
  const eligible: Candidate[] = [];
  const skipped: Skip[] = [];
  for (const full of fulls) {
    const { lead, audit, score, ch, pipeline } = full;
    const skip = (why: string) => skipped.push({ slug: lead.slug, name: lead.name, why });
    if (pipeline.status !== 'new') { skip(`status ${pipeline.status}`); continue; }
    if (alreadyPicked.has(lead.id)) { skip('already picked'); continue; }
    if (!score) { skip('not scored'); continue; }
    if (!f.tiers.includes(score.tier)) { skip(score.tier === 'X' ? `excluded: ${score.excluded_reason}` : `tier ${score.tier}`); continue; }
    if (!audit) { skip('not audited'); continue; }
    if (daysSince(audit.audited_at) > f.audit_fresh_days) { skip(`audit is ${Math.round(daysSince(audit.audited_at))} days old`); continue; }
    if ((lead.review_count ?? 0) < f.min_reviews) { skip(`${lead.review_count ?? 0} reviews, needs ${f.min_reviews}`); continue; }
    if (daysSince(lead.last_review_at) > f.max_review_age_days) { skip(lead.last_review_at ? `latest review ${Math.round(daysSince(lead.last_review_at))} days ago` : 'no review dates'); continue; }
    if (!findCategory(lead.category_key)) { skip(`category "${lead.category_key}" not configured`); continue; }
    if (lead.photo_count === null ? !f.allow_unknown_photos : lead.photo_count < f.min_photos) { skip(`${lead.photo_count ?? 'unknown'} photos, needs ${f.min_photos}`); continue; }
    if (f.require_contact && !lead.phone_e164 && ch?.match_confidence !== 'high') { skip('no phone and not a limited company'); continue; }
    const b = buildability(full, cfg);
    const ltd = ch?.match_confidence === 'high';
    const mult = multipliers.get(lead.category_key) ?? 1;
    const pickScore = Math.round((cfg.score.lead_weight * score.total + cfg.score.buildability_weight * b.score + (ltd ? cfg.score.ltd_bonus : 0)) * mult);
    const reasons = [
      `tier ${score.tier}, score ${score.total}`,
      `${lead.review_count} reviews at ${lead.rating}, latest ${Math.round(daysSince(lead.last_review_at))} days ago`,
      `buildability ${b.score} (${b.parts.join(', ')})`,
      ltd ? 'limited company, email route' : 'phone or walk-in route',
    ];
    if (mult !== 1) reasons.push(`category multiplier ${mult.toFixed(2)} from outcomes`);
    eligible.push({ full, buildability: b.score, buildabilityParts: b.parts, pickScore, reasons });
  }
  eligible.sort((a, b) => b.pickScore - a.pickScore || (b.full.lead.review_count ?? 0) - (a.full.lead.review_count ?? 0));
  return { eligible, skipped };
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

/** Slow learning from outcomes: a category's reply-or-win rate against the overall rate, once it has five contacts. */
export function outcomeMultipliers(stats: { category_key: string; contacted: number; positive: number }[]): { multipliers: Map<string, number>; overall: number | null } {
  const total = stats.reduce((a, s) => a + s.contacted, 0);
  if (!total) return { multipliers: new Map(), overall: null };
  const overall = stats.reduce((a, s) => a + s.positive, 0) / total;
  const m = new Map<string, number>();
  for (const s of stats) {
    if (s.contacted < 5) continue;
    m.set(s.category_key, Math.max(0.7, Math.min(1.3, 1 + (s.positive / s.contacted - overall))));
  }
  return { multipliers: m, overall };
}
