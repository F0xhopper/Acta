import { reachOf } from './reach.js';
import { contentOf } from './content.js';
import { weakSiteSignals, weakSiteSummary } from './weak-site.js';
import { findCategory, loadScoring, type Category, type Scoring } from '../config.js';
import { fullLeads, isSuppressed, saveScore } from '../db/queries.js';
import type { Channel, FullLead, ScoreRow, Tier } from '../db/types.js';
import { isoNow } from '../util/dates.js';
import { log } from '../util/log.js';
import { excludedType, isChainName } from '../util/business.js';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** The first-contact channel. Email only when there's an address to send to and cold email is allowed. */
export function pickChannel(full: FullLead, category: Category | undefined): Channel {
  const r = reachOf(full, category);
  if (r.emailAllowed) return 'email';
  if (r.walkIn) return 'walk_in';
  if (full.lead.phone_e164) return 'phone';
  if (r.socials.length) return 'dm';
  return 'walk_in';
}

export function scoreLead(full: FullLead, scoring: Scoring = loadScoring(), category: Category | undefined = findCategory(full.lead.category_key)): ScoreRow {
  const { lead, audit, ch } = full;
  const reasons: string[] = [];
  const base = (): ScoreRow => ({
    lead_id: lead.id, scored_at: isoNow(), opportunity: 0, viability: 0, total: 0, tier: 'X', channel: pickChannel(full, category), reasons_json: '[]', excluded_reason: null,
  });
  const exclude = (why: string): ScoreRow => ({ ...base(), reasons_json: JSON.stringify([why]), excluded_reason: why });

  if (lead.is_chain || isChainName(lead.name, scoring)) return exclude('Chain or franchise');
  const badType = excludedType(lead.primary_type, lead.types_json, scoring);
  if (badType) return exclude(`Not a pitchable business type (${badType.replace(/_/g, ' ')})`);
  if (lead.rating !== null && (lead.review_count ?? 0) >= scoring.viability.exclude_rating_min_reviews && lead.rating < scoring.viability.exclude_rating_under) {
    return exclude(`Poor reputation (${lead.rating} across ${lead.review_count} reviews)`);
  }
  if (lead.business_status && lead.business_status !== 'OPERATIONAL') return exclude(`Not operational (${lead.business_status})`);
  if (isSuppressed(lead, audit?.final_domain)) return exclude('On suppression list');
  if (!audit) return exclude('Not audited yet');

  // ---- opportunity ----
  const o = scoring.opportunity;
  let opportunity = o.status[audit.website_status] ?? 0;
  const statusReason: Record<string, string> = {
    none: 'No website on Google listing', down: 'Website is down', broken: 'Website is broken', directory_only: 'Only a directory listing, no real site',
    facebook_only: 'Only a social media page, no real site', platform_only: 'Only a booking or ordering platform page',
  };
  if (statusReason[audit.website_status]) reasons.push(statusReason[audit.website_status]);
  if (lead.found_site_url && audit.website_status !== 'live') reasons.push(`Has its own site (${lead.found_site_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}) that Google doesn't link`);
  if (audit.website_status === 'live') {
    const add = (pts: number, why: string) => { opportunity += pts; reasons.push(why); };
    if (audit.listing_link_broken) add(o.live.listing_link_broken, 'Google listing links to a page that no longer exists');
    if (audit.https_ok === 0) add(o.live.no_https, 'No HTTPS');
    if (audit.has_viewport === 0) add(o.live.no_viewport, 'Not mobile-friendly (no viewport meta)');
    if (audit.free_tier_host) add(o.live.free_tier_host, `Free-tier site on ${audit.final_domain}`);
    if (audit.lh_perf !== null && audit.lh_perf < 50) {
      add(o.live.perf_under_50, `Slow on mobile (Lighthouse ${audit.lh_perf})`);
      if (audit.lh_perf < 30) opportunity += o.live.perf_under_30_extra;
    }
    if (audit.copyright_year && new Date().getFullYear() - audit.copyright_year >= o.live.copyright_stale_years) add(o.live.copyright_stale, `Copyright ${audit.copyright_year}, looks unmaintained`);
    if (audit.builder && scoring.cheap_builders.includes(audit.builder)) add(o.live.cheap_builder, `Built on ${audit.builder}`);
    if (audit.lh_seo !== null && audit.lh_seo < 70) add(o.live.seo_under_70, `Weak SEO basics (Lighthouse SEO ${audit.lh_seo})`);
    if (!audit.title || audit.meta_desc_len === 0) add(o.live.no_title_or_desc, 'Missing title or meta description');
    if (audit.has_local_schema === 0) add(o.live.no_schema, 'No LocalBusiness schema');
    if (audit.phone_matches_listing === 0) add(o.live.phone_mismatch, 'Phone on site differs from Google listing');
    if (audit.ttfb_ms !== null && audit.ttfb_ms > o.live.ttfb_over_ms) add(o.live.ttfb_slow, `Slow server (${audit.ttfb_ms} ms to first byte)`);
    if (!audit.builder && audit.lh_perf !== null && audit.lh_perf >= 80 && reasons.length === 0) reasons.push('Modern site');
  }
  opportunity = clamp(opportunity);
  // A live site below the threshold is adequate and excluded, unless it shows its age: that owner has paid for a
  // site before and is the likeliest to pay again, so it stays in (tier C) for the picker's buyer lane.
  const weak = weakSiteSignals(audit, scoring);
  if (audit.website_status === 'live' && opportunity < scoring.thresholds.adequate_site_opportunity) {
    if (!weak.length) return { ...exclude('Site is adequate'), opportunity, channel: pickChannel(full, category) };
    reasons.push(`Already pays for a site, and it shows its age: ${weakSiteSummary(weak)}`);
  }

  // ---- viability ----
  const v = scoring.viability;
  let viability = 0;
  const rc = lead.review_count ?? 0;
  const band = v.reviews.find((r) => rc >= r.min);
  if (band) viability += band.points;
  if (lead.rating !== null) {
    if (lead.rating >= 4.0) viability += v.rating_4_0;
    if (lead.rating >= 4.5) viability += v.rating_4_5_extra;
    if (lead.rating < 3.5 && rc >= 10) { viability += v.low_rating_penalty; reasons.push(`Low rating ${lead.rating} across ${rc} reviews`); }
  }
  if (rc > 0 && lead.rating !== null) reasons.push(`${rc} reviews at ${lead.rating}`);
  else reasons.push('No reviews yet');
  if (lead.opening_hours_json) viability += v.hours_listed;
  // Activity. Reviews gained between sightings is the unbiased sign; the dates of Google's five shown reviews (the
  // most relevant, not the newest) only count for businesses with few reviews, where the five are nearly all of them.
  const gained = full.velocity?.gained ?? 0;
  const trustDates = rc < v.recency_trusted_under;
  if (gained > 0) {
    viability += v.recent_reviews;
    reasons.push(`Active, ${gained} new review${gained === 1 ? '' : 's'} since ${new Date(full.velocity!.firstAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
  } else if (lead.last_review_at) {
    const months = (Date.now() - new Date(lead.last_review_at).getTime()) / (30.44 * 86_400_000);
    const when = new Date(lead.last_review_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    if (months <= v.recent_review_months) { viability += v.recent_reviews; reasons.push(`Active, latest review ${when}`); }
    else if (months >= v.stale_review_months && trustDates) { viability += v.stale_reviews; reasons.push(`No recent reviews since ${when}, may be winding down`); }
  }
  if (category?.pays_for_marketing) viability += v.pays_for_marketing;
  const reach = reachOf(full, category);
  if (ch?.match_confidence === 'high') { viability += v.ltd_high; reasons.push(reach.email ? `Limited company with an email (${reach.email}): cold email allowed` : 'Limited company, but no email found: call or walk in first'); }
  else reasons.push('Entity unknown, treat as sole trader (no cold email)');
  if (!lead.phone_e164) { viability = Math.min(viability, v.no_phone_cap); reasons.push('No phone number listed'); }
  viability = clamp(viability);

  const content = contentOf(full, category);
  reasons.push(`${content.label} (content ${content.score})`);
  const total = clamp(scoring.total.opportunity_weight * opportunity + scoring.total.viability_weight * viability + scoring.total.content_weight * content.score);
  const tmin = scoring.thresholds.tier_min_viability;
  let t: Tier = 'C';
  const established = rc >= scoring.thresholds.tier_a_min_reviews;
  if (['none', 'down', 'broken', 'directory_only', 'facebook_only'].includes(audit.website_status) && viability >= tmin && established) t = 'A';
  else if (['live', 'platform_only'].includes(audit.website_status) && opportunity >= 50 && viability >= tmin && established) t = 'B';
  if (viability < scoring.thresholds.min_viability) t = 'X';

  return {
    lead_id: lead.id, scored_at: isoNow(), opportunity, viability, total, tier: t, channel: pickChannel(full, category),
    reasons_json: JSON.stringify([...reasons.slice(0, 6), ...(reasons.length > 6 ? [reasons[reasons.length - 1]] : [])]), excluded_reason: t === 'X' ? `Viability ${viability} below floor` : null,
  };
}

export function scoreAll(opts: { query?: string } = {}): { scored: number; byTier: Record<string, number> } {
  const scoring = loadScoring();
  const out = { scored: 0, byTier: {} as Record<string, number> };
  for (const full of fullLeads({ query: opts.query })) {
    const s = scoreLead(full, scoring);
    saveScore(s);
    out.scored++;
    out.byTier[s.tier] = (out.byTier[s.tier] ?? 0) + 1;
  }
  log.info(`score: ${out.scored} leads scored ${JSON.stringify(out.byTier)}`);
  return out;
}
