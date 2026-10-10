/**
 * A dead site is not a dead lead. When the website on a listing is down or broken, two free lookups say what
 * happened and what there is to work with. RDAP, the registries' own record, says whether the domain is still
 * registered, lapsing, or free to register again: a thriving business whose domain has expired is the hottest lead
 * there is, and "I can get it back for you" is a true opening line. The Wayback Machine keeps the last copy of the
 * site, which gives the build real photos, words and a logo, and the audit a description and contact details.
 * Both are cached per domain for a week. Nothing here throws: a failed lookup is `unknown`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, loadScoring } from '../config.js';
import type { AuditRow, LeadRow } from '../db/types.js';
import { isoNow } from '../util/dates.js';
import { fetchWithTimeout, hostOf, sleep } from '../util/http.js';
import { extractContacts, mergeContacts, type Social } from './contacts.js';
import { runHtmlChecks } from './html-checks.js';

export type DomainStatus = 'registered' | 'expiring' | 'available' | 'unknown';
export interface DomainInfo { status: DomainStatus; expiresAt: string | null; registeredAt: string | null }
/** `url` is the copy as a browser shows it (assets rewritten to web.archive.org); `rawUrl` is the original HTML. */
export interface Snapshot { url: string; rawUrl: string; at: string }
export interface Rescue { domain: DomainInfo; snapshot: Snapshot | null }

const UNKNOWN: DomainInfo = { status: 'unknown', expiresAt: null, registeredAt: null };
/** RDAP statuses (RFC 8056) that mean the registration is on its way out. */
const LAPSING = /pending ?delete|redemption ?period|client ?hold|server ?hold/i;

/** An RDAP response to a domain status. A 404 means nobody holds the name. Pure. */
export function parseRdap(status: number, body: unknown, now = new Date()): DomainInfo {
  if (status === 404) return { status: 'available', expiresAt: null, registeredAt: null };
  if (status !== 200 || !body || typeof body !== 'object') return UNKNOWN;
  const o = body as { status?: unknown; events?: unknown };
  const events = Array.isArray(o.events) ? (o.events as { eventAction?: unknown; eventDate?: unknown }[]) : [];
  const when = (action: string) => {
    const e = events.find((x) => String(x.eventAction ?? '').toLowerCase() === action);
    return e && typeof e.eventDate === 'string' && Number.isFinite(Date.parse(e.eventDate)) ? e.eventDate : null;
  };
  const expiresAt = when('expiration');
  const registeredAt = when('registration');
  const statuses = Array.isArray(o.status) ? (o.status as unknown[]).map(String) : [];
  const lapsing = statuses.some((s) => LAPSING.test(s)) || (!!expiresAt && Date.parse(expiresAt) < now.getTime());
  return { status: lapsing ? 'expiring' : 'registered', expiresAt, registeredAt };
}

/** The Wayback availability API's answer to a usable snapshot, or null. Pure. */
export function parseWayback(body: unknown): Snapshot | null {
  const c = (body as { archived_snapshots?: { closest?: { url?: unknown; timestamp?: unknown; status?: unknown; available?: unknown } } } | null)?.archived_snapshots?.closest;
  if (!c || typeof c.url !== 'string' || typeof c.timestamp !== 'string') return null;
  if (String(c.status) !== '200' || c.available !== true) return null;
  const ts = c.timestamp;
  if (!/^\d{14}$/.test(ts)) return null;
  const m = c.url.match(/^https?:\/\/web\.archive\.org\/web\/\d{14}(?:[a-z]{2}_)?\/(.+)$/);
  const original = m ? m[1] : c.url;
  const at = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
  if (!Number.isFinite(Date.parse(at))) return null;
  return { url: `https://web.archive.org/web/${ts}/${original}`, rawUrl: `https://web.archive.org/web/${ts}id_/${original}`, at };
}

/** The original URL inside a web.archive.org URL, or null when it isn't one. Pure. */
export function archiveOriginal(url: string): string | null {
  const m = url.match(/^https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:[a-z]{2}_)?\/(.+)$/i);
  return m ? m[1] : null;
}

export interface RescueDeps { fetch: typeof fetchWithTimeout; cacheDir?: string; now?: () => Date; pauseMs?: number }
const DEFAULT_DEPS: RescueDeps = { fetch: fetchWithTimeout };
const CACHE_DAYS = 7;
/** The archive blocks bursts per address and user agent for a minute or so: three tries, a pause between, two identities, two forms. */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PLAIN_UA = 'acta-pipeline/1.0 (+https://actastudio.co.uk; one read of an archived copy)';
const BLOCK_PAGE = /wayback machine/i;

/** The archive's rewritten HTML back to something like the original: toolbar and scripts out, wrapped URLs unwrapped. Pure. */
export function unwrapArchiveHtml(html: string): string {
  return html
    .replace(/<!--\s*BEGIN WAYBACK TOOLBAR INSERT\s*-->[\s\S]*?<!--\s*END WAYBACK TOOLBAR INSERT\s*-->/gi, '')
    .replace(/<script[^>]*(?:\/_static\/|wombat|archive\.org\/_static)[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>(?:(?!<\/script>)[\s\S])*?__wm\.(?:init|wombat|bt)[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]*\/_static\/[^>]*>/gi, '')
    .replace(/https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:[a-z]{2}_)?\//gi, '')
    .replace(/(["'(=])\/web\/\d{1,14}(?:[a-z]{2}_)?\//gi, '$1');
}

/** The original HTML of an archived copy, or null when the archive would not give it this time. */
export async function readSnapshot(snap: Snapshot, deps: RescueDeps = DEFAULT_DEPS): Promise<string | null> {
  const plan = [{ url: snap.rawUrl, ua: BROWSER_UA, raw: true }, { url: snap.rawUrl, ua: PLAIN_UA, raw: true }, { url: snap.url, ua: PLAIN_UA, raw: false }];
  for (const [i, p] of plan.entries()) {
    if (i) await sleep(deps.pauseMs ?? 15000 * i);
    try {
      const res = await deps.fetch(p.url, { timeoutMs: 25000, headers: { 'user-agent': p.ua, accept: 'text/html,*/*;q=0.8' } });
      const text = await res.text();
      if (!res.ok || !text) continue;
      if (text.length < 2000 && BLOCK_PAGE.test(text) && /block|abus/i.test(text)) continue;
      return p.raw ? text : unwrapArchiveHtml(text);
    } catch { /* the next form or identity */ }
  }
  return null;
}

const cacheFile = (dir: string, domain: string) => { mkdirSync(dir, { recursive: true }); return join(dir, `${createHash('sha1').update(domain).digest('hex')}.json`); };

async function domainStatus(domain: string, deps: RescueDeps): Promise<DomainInfo> {
  try {
    // rdap.org bootstraps to the registry's own server (Nominet for .uk, Verisign for .com); the redirect is followed.
    const res = await deps.fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeoutMs: 15000, headers: { accept: 'application/rdap+json, application/json' } });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return parseRdap(res.status, body, deps.now?.() ?? new Date());
  } catch { return UNKNOWN; }
}

async function waybackSnapshot(domain: string, deps: RescueDeps): Promise<Snapshot | null> {
  try {
    const res = await deps.fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(domain)}`, { timeoutMs: 15000, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return parseWayback(JSON.parse(await res.text()));
  } catch { return null; }
}

/** Both lookups for a domain, cached for a week. Never throws. */
export async function lookupDomain(domain: string, deps: RescueDeps = DEFAULT_DEPS): Promise<Rescue> {
  const f = cacheFile(deps.cacheDir ?? join(CACHE_DIR, 'rescue'), domain.toLowerCase());
  if (existsSync(f)) {
    try {
      const { at, data } = JSON.parse(readFileSync(f, 'utf8')) as { at: string; data: Rescue };
      if ((Date.now() - new Date(at).getTime()) / 86_400_000 <= CACHE_DAYS && data.domain.status !== 'unknown') return data;
    } catch { /* look again */ }
  }
  const [dom, snapshot] = await Promise.all([domainStatus(domain, deps), waybackSnapshot(domain, deps)]);
  const data: Rescue = { domain: dom, snapshot };
  try { writeFileSync(f, JSON.stringify({ at: isoNow(), data })); } catch { /* cache is best effort */ }
  return data;
}

/** The domain a dead audit was about. */
export function deadDomain(lead: Pick<LeadRow, 'website_url'>, audit: Pick<AuditRow, 'final_domain' | 'input_url'>): string | null {
  const fromUrl = (u: string | null | undefined) => (u ? hostOf(/^https?:\/\//i.test(u) ? u : `http://${u}`) : null);
  const host = audit.final_domain?.toLowerCase().replace(/^www\./, '') ?? fromUrl(audit.input_url) ?? fromUrl(lead.website_url);
  return host && host.includes('.') ? host : null;
}

export const isDead = (status: string | null | undefined) => status === 'down' || status === 'broken';

/**
 * For a down or broken site: the domain's registration state and the last archived copy, written onto the audit.
 * The copy fills what the audit has nothing for: a description, emails and social links, the limited-company hint.
 * Never throws; a failed lookup leaves `domain_status` as `unknown`.
 */
export async function rescueDeadSite(lead: LeadRow, audit: AuditRow, deps: RescueDeps = DEFAULT_DEPS): Promise<AuditRow> {
  if (!isDead(audit.website_status)) return audit;
  const domain = deadDomain(lead, audit);
  if (!domain) { audit.domain_status = 'unknown'; audit.rescued_at = isoNow(); return audit; }
  const r = await lookupDomain(domain, deps);
  audit.domain_status = r.domain.status;
  audit.domain_expires_at = r.domain.expiresAt;
  audit.wayback_url = r.snapshot?.url ?? null;
  audit.wayback_at = r.snapshot?.at ?? null;
  // Stamped only once something was learned: a lookup that failed outright is tried again on the next run.
  if (!r.snapshot) { if (r.domain.status !== 'unknown') audit.rescued_at = isoNow(); return audit; }
  // Likewise a rate-limited read of the copy.
  const html = await readSnapshot(r.snapshot, deps);
  if (!html) return audit;
  audit.rescued_at = isoNow();
  try {
    // Relative links in the original HTML resolve against the business's own domain, not the archive's.
    const base = `https://${domain}/`;
    const h = runHtmlChecks(html, {}, domain, lead.phone_e164, loadScoring());
    if (!audit.site_description && h.description) audit.site_description = h.description;
    if (!audit.ltd_hint && h.ltdHint) audit.ltd_hint = 1;
    if (!audit.title && h.title) audit.title = h.title;
    const arr = <T,>(s: string | null | undefined): T[] => { try { const v = s ? (JSON.parse(s) as unknown) : []; return Array.isArray(v) ? (v as T[]) : []; } catch { return []; } };
    const c = mergeContacts({ emails: arr<string>(audit.emails_json), socials: arr<Social>(audit.socials_json) }, extractContacts(html, base));
    audit.emails_json = JSON.stringify(c.emails);
    audit.socials_json = JSON.stringify(c.socials);
  } catch { /* the copy could not be read: the domain state alone is still worth having */ }
  return audit;
}
