import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../config.js';
import type { FullLead } from '../db/types.js';
import { hostOf } from '../util/http.js';
import { displayUkPhone } from '../util/phone.js';
import { describeLead, SOURCE_LABEL } from './describe.js';

export const esc = (v: unknown): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/** Markdown link. Angle brackets keep URLs with odd characters intact. */
export const link = (text: string, url: string | null | undefined): string =>
  url ? `[${esc(text).replace(/[[\]]/g, '')}](<${url}>)` : esc(text);

export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) { const k = key(i); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const STATUS_LABEL: Record<string, string> = {
  none: 'No website', facebook_only: 'Social page only', directory_only: 'Directory only', platform_only: 'Booking page only',
  down: 'Down', broken: 'Broken', live: 'Live', unaudited: 'Not audited',
};
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', phone: 'Phone', walk_in: 'Walk in', dm: 'DM' };

export function telLink(e164: string | null | undefined): string {
  return e164 ? `[${displayUkPhone(e164)}](tel:${e164})` : 'none listed';
}

export const mapsLink = (r: FullLead) => link(r.lead.name, r.lead.google_maps_url);
export const siteUrl = (r: FullLead) => r.audit?.final_url ?? r.lead.website_url ?? null;

export function siteCell(r: FullLead): string {
  const label = STATUS_LABEL[r.audit?.website_status ?? 'unaudited'] ?? r.audit?.website_status ?? '';
  const url = siteUrl(r);
  if (!url) return label;
  let host = hostOf(url.startsWith('http') ? url : `http://${url}`) ?? 'site';
  if (host.length > 30) host = `${host.slice(0, 28)}…`;
  return `${label}: ${link(host, url)}`;
}

/** Clickable website, or "none". */
export function websiteLink(r: FullLead): string {
  const url = siteUrl(r);
  if (!url) return 'none';
  let host = hostOf(url.startsWith('http') ? url : `http://${url}`) ?? url;
  if (host.length > 34) host = `${host.slice(0, 32)}…`;
  return link(host, url.startsWith('http') ? url : `http://${url}`);
}

export const statusLabel = (r: FullLead) => STATUS_LABEL[r.audit?.website_status ?? 'unaudited'] ?? r.audit?.website_status ?? '';

export function aboutText(r: FullLead, max = 0): string {
  const d = describeLead(r);
  const t = max && d.text.length > max ? `${d.text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : d.text;
  return `${t} *(${SOURCE_LABEL[d.source]})*`;
}

export function latestReviewText(r: FullLead): string {
  if (!r.lead.last_review_at) return 'unknown';
  return new Date(r.lead.last_review_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function reviewsText(r: FullLead): string {
  const rc = r.lead.review_count ?? 0;
  return rc ? `${r.lead.rating}★ from ${rc}` : 'no reviews';
}

export function entityText(r: FullLead): string {
  return r.ch?.match_confidence === 'high'
    ? `Limited company${r.ch.company_number ? ` (${r.ch.company_number})` : ''}`
    : 'Sole trader or unknown, no cold email';
}

/** Score reasons. Compact drops the ones already shown in their own column. */
export function reasonsOf(r: FullLead, compact = false): string[] {
  const all: string[] = r.score ? JSON.parse(r.score.reasons_json) : [];
  return compact ? all.filter((x) => !/^(Entity unknown|Limited company|\d+ reviews at|No reviews yet)/.test(x)) : all;
}

/** One sentence you could say to the owner. Factual, from the audit. */
export function hook(r: FullLead): string {
  const { lead, audit } = r;
  const rc = lead.review_count ?? 0;
  const proof = rc ? `${rc} reviews at ${lead.rating}` : 'no reviews yet';
  const host = audit?.final_domain ?? (lead.website_url ? hostOf(lead.website_url) : null) ?? '';
  switch (audit?.website_status) {
    case 'none': return `No website. ${cap(proof)} on Google, but nowhere to send people.`;
    case 'down': return `Website is down. The link on their Google listing goes nowhere, and they have ${proof}.`;
    case 'broken': {
      const why = audit.tls_error ? ' (security certificate error)' : audit.http_status && audit.http_status >= 400 ? ` (${audit.http_status} error)` : ' (parked or empty page)';
      return `Website is broken${why}. Anyone clicking through from Google hits a dead end.`;
    }
    case 'facebook_only': return `Only a social media page. ${cap(proof)}, but no site of their own.`;
    case 'directory_only': return `Only a directory listing${host ? ` on ${host}` : ''}. No site of their own.`;
    case 'platform_only': return `Only a booking or ordering page${host ? ` on ${host}` : ''}. No site of their own.`;
    case 'live': {
      const p: string[] = [];
      if (audit.listing_link_broken) p.push('is linked from Google to a page that no longer exists');
      if (audit.has_viewport === 0) p.push("isn't built for phones");
      if (audit.https_ok === 0) p.push('has no HTTPS, so browsers mark it not secure');
      if (audit.lh_perf !== null && audit.lh_perf < 50) p.push(`is slow on a phone (Lighthouse ${audit.lh_perf}/100)`);
      if (audit.free_tier_host) p.push(`is still on a free ${audit.builder ?? 'builder'} address`);
      if (audit.copyright_year && new Date().getFullYear() - audit.copyright_year >= 3) p.push(`looks untouched since ${audit.copyright_year}`);
      if (audit.lh_seo !== null && audit.lh_seo < 70) p.push(`has weak Google basics (SEO ${audit.lh_seo}/100)`);
      if (!p.length) return 'Site works but could be doing more for them.';
      return `Their site ${p.slice(0, 2).join(' and ')}.`;
    }
    default: return 'Not audited yet.';
  }
}

export function nextAction(r: FullLead): string {
  const phone = r.lead.phone_e164 ? displayUkPhone(r.lead.phone_e164) : null;
  switch (r.score?.channel) {
    case 'email': return 'Email the preview link. Limited company, so cold email is allowed.';
    case 'walk_in': return 'Walk in mid-afternoon with the preview open on your phone.';
    case 'dm': return 'DM on Instagram or Facebook with the preview link.';
    default: return phone ? `Call ${phone}, then text the preview link.` : 'Find a contact route first, no phone listed.';
  }
}

/** Newest pack for a lead anywhere under out/. */
export function findPack(slug: string): string | null {
  if (!existsSync(OUT_DIR)) return null;
  const dirs = readdirSync(OUT_DIR).filter((d) => { try { return statSync(join(OUT_DIR, d)).isDirectory(); } catch { return false; } }).sort().reverse();
  for (const d of dirs) {
    const p = join(OUT_DIR, d, 'leads', slug, 'notes.md');
    if (existsSync(p)) return p;
  }
  return null;
}

/** A pitch card: everything needed to act on one lead. */
export function card(r: FullLead, rank: number, packRel: string | null, shotRel: string | null): string[] {
  const s = r.score!;
  const files = [packRel ? link('Pitch pack', packRel) : null, shotRel ? link('Their site on a phone', shotRel) : null, link('Google Maps', r.lead.google_maps_url)]
    .filter(Boolean).join(' · ');
  return [
    `### ${rank}. ${esc(r.lead.name)}`,
    '',
    `**Tier ${s.tier} · ${s.total}/100** (opportunity ${s.opportunity}, viability ${s.viability}) · ${esc(r.lead.category_key.replace(/_/g, ' '))} in ${esc(r.lead.area)}`,
    '',
    `> ${hook(r)}`,
    '',
    '| | |',
    '|---|---|',
    `| About | ${esc(aboutText(r))} |`,
    `| Phone | ${telLink(r.lead.phone_e164)} |`,
    `| Website | ${websiteLink(r)} · ${statusLabel(r)} |`,
    `| Reviews | ${reviewsText(r)}, latest ${latestReviewText(r)} |`,
    `| Business type | ${entityText(r)} |`,
    `| Why it ranks | ${esc(reasonsOf(r).join('; '))} |`,
    `| Next step | ${esc(nextAction(r))} |`,
    `| Files | ${files} |`,
  ];
}

export function groupExclusion(reason: string | null): string {
  if (!reason) return 'Unknown';
  if (reason.startsWith('Viability')) return 'Too small or unestablished';
  if (reason.startsWith('Not a pitchable business type')) return 'Not a customer (station, hotel, school ...)';
  if (reason.startsWith('Poor reputation')) return 'Poor reputation';
  if (reason.startsWith('Not operational')) return 'Closed';
  return reason;
}
