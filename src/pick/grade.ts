/**
 * Qualifying a lead: gates it must all clear to pass, and a grade (0-100) that ranks the ones that do. Each gate and
 * each part of the grade says why, in words, so a pass or a near miss can be read and argued with. Pure: everything
 * comes from the lead, its audit, Companies House, its score and its category.
 */
import { loadScoring, type Category, type Scoring } from '../config.js';
import type { FullLead } from '../db/types.js';
import { contentOf } from '../score/content.js';
import { reachOf, REACH_LABEL } from '../score/reach.js';
import { weakSiteSignals, weakSiteSummary } from '../score/weak-site.js';
import type { PickConfig, Route } from './config.js';
import { NO_LEARNING, tradeValue, type TradeLearning, type TradeValue } from './trade.js';

export type GateKey = 'eligible' | 'trade' | 'gap' | 'established' | 'reach' | 'content';
export interface Gate { key: GateKey; label: string; pass: boolean; detail: string; short: string }   // short: what's wrong in two or three words
export type GradeKey = keyof PickConfig['grade'];
export interface GradePart { key: GradeKey; label: string; points: number; max: number; detail: string }
export type Verdict = 'pass' | 'near' | 'fail';
export interface Grade { verdict: Verdict; gates: Gate[]; failed: Gate[]; score: number; parts: GradePart[]; contentScore: number; trade: TradeValue }

const NO_REAL_SITE: Record<string, string> = {
  none: 'No website', down: 'Website is down', broken: 'Website is broken', directory_only: 'Only a directory listing',
  facebook_only: 'Only a social page', platform_only: 'Only a booking or ordering page',
};
const daysSince = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Number.POSITIVE_INFINITY);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Years since incorporation, or null when unknown. Pure. */
export const companyAgeYears = (dateOfCreation: string | null | undefined, now = new Date()): number | null => {
  if (!dateOfCreation) return null;
  const t = Date.parse(dateOfCreation);
  return Number.isFinite(t) ? (now.getTime() - t) / (365.25 * 86_400_000) : null;
};

/** `learn`: pitch outcomes by trade, so trade value follows your results (src/pick/trade.ts). */
export function gradeLead(full: FullLead, cfg: PickConfig, category: Category | undefined, learn: TradeLearning = NO_LEARNING, scoring: Scoring = loadScoring()): Grade {
  const { lead, audit, score, ch } = full;
  const g = cfg.gates;
  const reach = reachOf(full, category);
  const content = contentOf(full, category);
  const status = audit?.website_status ?? 'none';
  const opportunity = score?.opportunity ?? 0;
  const rc = lead.review_count ?? 0;
  const age = daysSince(lead.last_review_at);
  const ltd = ch?.match_confidence === 'high';
  const trade = tradeValue(category, learn, cfg);
  // Activity: reviews gained between sightings is the unbiased sign. Google's five shown reviews are the most relevant,
  // not the newest, so their dates only count for businesses with few reviews.
  const gained = full.velocity?.gained ?? 0;
  const trustDates = rc < g.recency_reviews_under;
  const active = gained > 0;
  // The buyer lane: a live site that shows its age, in a trade worth replacing it for. That owner has paid for a site before.
  const weak = weakSiteSignals(audit, scoring);
  const buyer = status === 'live' && weak.length > 0 && trade.value >= g.weak_site_trade_value;
  const years = companyAgeYears(ch?.date_of_creation);
  const young = ltd && years !== null && years >= 1 && years <= 5;

  // ---- gates ----
  const gates: Gate[] = [];
  const gate = (key: GateKey, label: string, pass: boolean, detail: string, short = '') => gates.push({ key, label, pass, detail, short: pass ? '' : short || label });
  gate('eligible', 'Eligible', !!score && score.tier !== 'X', !score ? 'Not scored yet' : score.tier === 'X' ? score.excluded_reason ?? 'Excluded' : 'Independent, trading, not on the suppression list', score?.excluded_reason ?? 'Excluded');
  gate('trade', 'Pays for a site', !!category && trade.value >= g.min_trade_value,
    !category ? `"${lead.category_key}" isn't a configured trade` : `${trade.detail}${trade.value >= g.min_trade_value ? '' : `, needs ${g.min_trade_value}: this trade rarely pays for a website`}`, 'Trade rarely pays');
  const noSite = audit ? NO_REAL_SITE[status] : undefined;
  const gapDetail = !audit ? 'Not audited yet'
    : noSite ?? (opportunity >= g.min_opportunity ? `Has a site, a weak one (opportunity ${opportunity})`
    : buyer ? `Has a site that shows its age (${weakSiteSummary(weak)}): already pays for one, worth replacing for a ${trade.value}-value trade`
    : weak.length ? `Has a site that shows its age (${weakSiteSummary(weak)}), but ${category?.key.replace(/_/g, ' ') ?? 'the trade'} is worth ${trade.value}, under the ${g.weak_site_trade_value} a replacement pitch needs`
    : `Has a site, a decent one (opportunity ${opportunity}, needs ${g.min_opportunity})`);
  gate('gap', 'Needs a site', !!noSite || (status === 'live' && (opportunity >= g.min_opportunity || buyer)), gapDetail, audit ? 'Site is decent' : 'Not audited');
  const recencyFail = !active && trustDates && age > g.max_review_age_days;
  const estFails = [rc < g.min_reviews ? `${rc} reviews, needs ${g.min_reviews}` : null, lead.rating !== null && lead.rating < g.min_rating ? `rated ${lead.rating}, needs ${g.min_rating}` : null,
    recencyFail ? (lead.last_review_at ? `latest review ${Math.round(age)} days ago` : 'no review dates') : null].filter(Boolean);
  const activity = active ? `${gained} new review${gained === 1 ? '' : 's'} since ${shortDate(full.velocity!.firstAt)}` : trustDates && lead.last_review_at ? `latest ${Math.round(age)} days ago` : `dates not counted at ${rc} reviews (Google shows the most relevant five, not the newest)`;
  gate('established', 'Established', !estFails.length, estFails.length ? estFails.join('; ') : `${rc} reviews at ${lead.rating}, ${activity}`,
    rc < g.min_reviews ? 'Too few reviews' : lead.rating !== null && lead.rating < g.min_rating ? 'Low rating' : 'No recent reviews');
  const routes = routesOf(reach);
  const via = routes.filter((r) => g.reach.includes(r));
  gate('reach', 'Reachable', via.length > 0,
    reach.level === 'email' ? `Email ${reach.email}, limited company: cold email allowed`
    : reach.email ? `${reach.email}, but not a limited company: call first, then email the link`
    : via.length ? `${ROUTE_LABEL[via[0]]}: call first, then send the link there${ltd ? '. A limited company: find their email and it can be cold emailed' : ''}`
    : ltd ? 'Limited company, no email found: check their Facebook page'
    : `${REACH_LABEL[reach.level]}: nowhere to send the link without asking for an email first`,
    ltd && !reach.email ? 'Find their email' : reach.level === 'call' ? 'Landline only' : reach.level === 'visit' ? 'Visit only' : 'No contact');
  gate('content', 'Enough to build from', content.score >= g.min_content, `${content.label} (content ${content.score}${content.score >= g.min_content ? '' : `, needs ${g.min_content}`})`, 'Little to build from');
  const failed = gates.filter((x) => !x.pass);
  const verdict: Verdict = !failed.length ? 'pass' : failed.length === 1 && failed[0].key !== 'eligible' ? 'near' : 'fail';

  // ---- grade ----
  const w = cfg.grade;
  const parts: GradePart[] = [];
  const part = (key: GradeKey, label: string, frac: number, detail: string) => parts.push({ key, label, points: Math.round(w[key] * clamp01(frac) * 10) / 10, max: w[key], detail });
  // The buyer lane counts as at least the gap threshold: a weak site they paid for says more than its score.
  part('gap', 'How much a site would help', (buyer ? Math.max(opportunity, g.min_opportunity) : opportunity) / 100,
    noSite ? `${noSite} (opportunity ${opportunity})` : buyer ? `Weak site they already pay for (${weakSiteSummary(weak)})` : `Opportunity ${opportunity}`);
  part('trade', 'Trade value', trade.value / 100, trade.detail);
  const repReviews = rc ? clamp01(Math.log10(rc) / Math.log10(200)) : 0;
  const repRating = lead.rating !== null ? clamp01((lead.rating - 3.5) / 1.5) : 0;
  const repRecent = active ? 1 : !trustDates ? 0.6 : age <= 90 ? 1 : age <= 365 ? 0.6 : age <= 730 ? 0.2 : 0;
  part('reputation', 'Reputation', 0.5 * repReviews + 0.3 * repRating + 0.2 * repRecent,
    `${rc} reviews${lead.rating !== null ? ` at ${lead.rating}` : ''}, ${activity}`);
  // A mobile beats a landline-plus-email: a call then a WhatsApp is how trades actually get the link.
  const reachFrac = reach.emailAllowed ? 1 : reach.mobile ? 0.7 : reach.email ? 0.6 : reach.socials.length ? 0.4 : reach.level === 'call' ? 0.2 : reach.level === 'visit' ? 0.05 : 0;
  part('reach', 'Reach', reachFrac, reach.emailAllowed ? 'Cold email allowed' : reach.mobile ? `Mobile${reach.email ? ' and an email' : ''}: call, then WhatsApp` : reach.email ? 'Has an email, call first' : REACH_LABEL[reach.level]);
  part('content', 'Content to build from', content.score / 100, `${content.label} (${content.score})`);
  const means = [ltd ? (young ? `limited company incorporated ${ch!.date_of_creation!.slice(0, 4)}, in its buying years` : `limited company${years !== null ? `, ${Math.round(years)} years old` : ''}`) : null,
    category?.pays_for_marketing ? 'trade pays for marketing' : null, rc >= 50 ? `${rc} reviews, a busy business` : null].filter(Boolean) as string[];
  part('means', 'Can pay', (ltd ? 0.4 : 0) + (young ? 0.2 : 0) + (category?.pays_for_marketing ? 0.2 : 0) + (rc >= 50 ? 0.2 : 0), means.length ? means.join(', ') : 'Sole trader, small');
  const total = Math.round(parts.reduce((a, p) => a + p.points, 0));
  return { verdict, gates, failed, score: total, parts, contentScore: content.score, trade };
}

const ROUTE_LABEL: Record<Route, string> = { cold_email: 'Cold email', email: 'Their email', mobile: 'Their mobile (WhatsApp)', social: 'Their social page', landline: 'Their landline', visit: 'A visit' };

/** Every way the preview could reach them. Pure. */
export function routesOf(reach: ReturnType<typeof reachOf>): Route[] {
  const out: Route[] = [];
  if (reach.emailAllowed) out.push('cold_email');
  if (reach.email) out.push('email');
  if (reach.mobile) out.push('mobile');
  if (reach.socials.length) out.push('social');
  if (reach.phone && !reach.mobile) out.push('landline');
  if (reach.walkIn) out.push('visit');
  return out;
}

/** One line for a near miss or a fail: what it's missing. Pure. */
export const missing = (gr: Grade) => gr.failed.map((f) => `${f.label}: ${f.detail}`).join('; ');
