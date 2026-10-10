import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveOriginal, deadDomain, lookupDomain, parseRdap, parseWayback, rescueDeadSite, unwrapArchiveHtml, type RescueDeps } from '../src/audit/rescue.js';
import type { AuditRow, LeadRow } from '../src/db/types.js';

const now = new Date('2026-10-10T12:00:00Z');

describe('parseRdap', () => {
  it('a 404 means nobody holds the name', () => {
    expect(parseRdap(404, null, now)).toEqual({ status: 'available', expiresAt: null, registeredAt: null });
  });
  it('an active registration with its dates', () => {
    const r = parseRdap(200, { status: ['active'], events: [{ eventAction: 'registration', eventDate: '2022-10-28T11:12:07Z' }, { eventAction: 'expiration', eventDate: '2026-10-28T12:12:07Z' }] }, now);
    expect(r).toEqual({ status: 'registered', expiresAt: '2026-10-28T12:12:07Z', registeredAt: '2022-10-28T11:12:07Z' });
  });
  it('a lapsing registration: on hold, pending delete, or past its expiry', () => {
    expect(parseRdap(200, { status: ['client hold'], events: [] }, now).status).toBe('expiring');
    expect(parseRdap(200, { status: ['pending delete'], events: [] }, now).status).toBe('expiring');
    expect(parseRdap(200, { status: ['redemption period'], events: [] }, now).status).toBe('expiring');
    expect(parseRdap(200, { status: ['active'], events: [{ eventAction: 'expiration', eventDate: '2026-09-01T00:00:00Z' }] }, now).status).toBe('expiring');
    // Verisign's usual lock statuses are not lapsing.
    expect(parseRdap(200, { status: ['client delete prohibited', 'client transfer prohibited'], events: [] }, now).status).toBe('registered');
  });
  it('anything else is unknown', () => {
    expect(parseRdap(500, {}, now).status).toBe('unknown');
    expect(parseRdap(200, 'not json', now).status).toBe('unknown');
    expect(parseRdap(200, null, now).status).toBe('unknown');
    expect(parseRdap(200, { events: [{ eventAction: 'expiration', eventDate: 'yesterday' }] }, now)).toEqual({ status: 'registered', expiresAt: null, registeredAt: null });
  });
});

describe('parseWayback', () => {
  const closest = (over: Record<string, unknown> = {}) => ({ archived_snapshots: { closest: { status: '200', available: true, url: 'http://web.archive.org/web/20260612230259/https://thedenturepractice.com/', timestamp: '20260612230259', ...over } } });
  it('a usable snapshot: the browser URL, the raw-HTML URL and the date', () => {
    expect(parseWayback(closest())).toEqual({
      url: 'https://web.archive.org/web/20260612230259/https://thedenturepractice.com/',
      rawUrl: 'https://web.archive.org/web/20260612230259id_/https://thedenturepractice.com/',
      at: '2026-06-12T23:02:59Z',
    });
  });
  it('nothing archived, an error page, or an unavailable copy give null', () => {
    expect(parseWayback({ url: 'x', archived_snapshots: {} })).toBeNull();
    expect(parseWayback(closest({ status: '404' }))).toBeNull();
    expect(parseWayback(closest({ available: false }))).toBeNull();
    expect(parseWayback(closest({ timestamp: '2026' }))).toBeNull();
    expect(parseWayback(null)).toBeNull();
    expect(parseWayback('')).toBeNull();
  });
});

describe('archiveOriginal', () => {
  it('unwraps the original URL, with or without a flag', () => {
    expect(archiveOriginal('https://web.archive.org/web/20260612230259/https://acme.co.uk/about')).toBe('https://acme.co.uk/about');
    expect(archiveOriginal('https://web.archive.org/web/20260612230259im_/https://acme.co.uk/logo.png')).toBe('https://acme.co.uk/logo.png');
    expect(archiveOriginal('https://acme.co.uk/about')).toBeNull();
  });
});

const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: 1, slug: 'acme', place_id: 'p', name: 'Acme Plumbing', category_key: 'plumber', category_raw: 'plumbers', area: 'Erdington', source_query: 'q', address: '1 High St', postcode: 'B23 6QQ',
  outward_code: 'B23', lat: null, lng: null, phone_e164: '+441211234567', website_url: 'http://acmeplumbing.co.uk', google_maps_url: null, rating: 4.8, review_count: 40, business_status: 'OPERATIONAL',
  primary_type: null, types_json: null, opening_hours_json: null, is_chain: 0, raw_json: null, discovered_at: '', last_seen_at: '', type_label: null, editorial_summary: null, reviews_json: null, last_review_at: null, photo_count: null, ...over,
});
const audit = (over: Partial<AuditRow> = {}): AuditRow => ({
  lead_id: 1, audited_at: '', run_id: null, website_status: 'down', input_url: 'http://acmeplumbing.co.uk', final_url: null, final_domain: 'acmeplumbing.co.uk', http_status: null, tls_error: null, redirect_count: null, ttfb_ms: null,
  https_ok: null, http_redirects_to_https: null, has_viewport: null, title: null, title_len: null, meta_desc_len: null, h1_count: null, builder: null, free_tier_host: null, copyright_year: null,
  phone_on_page: null, phone_matches_listing: null, has_local_schema: null, ltd_hint: null, lh_perf: null, lh_seo: null, lh_a11y: null, lh_bp: null, lh_error: null, lh_json_path: null,
  screenshot_mobile: null, screenshot_desktop: null, error: 'ENOTFOUND', emails_json: null, socials_json: null, site_description: null,
  domain_status: null, domain_expires_at: null, wayback_url: null, wayback_at: null, rescued_at: null, ...over,
});
const html = `<!doctype html><html><head><title>Acme Plumbing</title><meta name="description" content="Family-run Gas Safe plumbers in Erdington since 1998, boilers, bathrooms and emergency repairs."></head>
<body><p>Call 0121 123 4567 or email <a href="mailto:hello@acmeplumbing.co.uk">hello@acmeplumbing.co.uk</a>.</p><a href="https://www.instagram.com/acmeplumbing">Instagram</a>
<footer>Acme Plumbing Ltd, registered in England</footer></body></html>`;
const wayback = { archived_snapshots: { closest: { status: '200', available: true, url: 'http://web.archive.org/web/20250301120000/http://acmeplumbing.co.uk/', timestamp: '20250301120000' } } };
const deps = (rdap: { status: number; body?: unknown }, wb: unknown, page: { status: number; body: string } | Error = { status: 200, body: html }): RescueDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    cacheDir: mkdtempSync(join(tmpdir(), 'rescue-')),
    now: () => now,
    pauseMs: 0,
    fetch: async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://rdap.org/')) return new Response(rdap.body === undefined ? '' : JSON.stringify(rdap.body), { status: rdap.status });
      if (url.startsWith('https://archive.org/wayback/available')) return new Response(JSON.stringify(wb), { status: 200 });
      if (url.includes('id_/')) { if (page instanceof Error) throw page; return new Response(page.body, { status: page.status }); }
      throw new Error(`unexpected ${url}`);
    },
  };
};

describe('rescueDeadSite', () => {
  it('an expired domain with an archived copy: the state, the copy, and what the copy says', async () => {
    const d = deps({ status: 404 }, wayback);
    const a = await rescueDeadSite(lead(), audit(), d);
    expect(a.domain_status).toBe('available');
    expect(a.wayback_url).toBe('https://web.archive.org/web/20250301120000/http://acmeplumbing.co.uk/');
    expect(a.wayback_at).toBe('2025-03-01T12:00:00Z');
    expect(a.rescued_at).toBeTruthy();
    expect(d.calls).toContain('https://web.archive.org/web/20250301120000id_/http://acmeplumbing.co.uk/');
    expect(a.site_description).toMatch(/Gas Safe plumbers in Erdington/);
    expect(a.title).toBe('Acme Plumbing');
    expect(a.ltd_hint).toBe(1);
    expect(JSON.parse(a.emails_json!)).toEqual(['hello@acmeplumbing.co.uk']);
    expect(JSON.parse(a.socials_json!)).toEqual([{ kind: 'instagram', url: 'https://instagram.com/acmeplumbing' }]);
  });
  it('keeps what the audit already had and only fills the gaps', async () => {
    const a = await rescueDeadSite(lead(), audit({ website_status: 'broken', site_description: 'From the live fetch', emails_json: '["info@acmeplumbing.co.uk"]' }), deps({ status: 200, body: { status: ['active'], events: [{ eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }] } }, wayback));
    expect(a.domain_status).toBe('registered');
    expect(a.domain_expires_at).toBe('2027-01-01T00:00:00Z');
    expect(a.site_description).toBe('From the live fetch');
    expect(JSON.parse(a.emails_json!)).toEqual(['info@acmeplumbing.co.uk', 'hello@acmeplumbing.co.uk']);
  });
  it('no archived copy: the domain state alone', async () => {
    const d = deps({ status: 200, body: { status: ['client hold'] } }, { archived_snapshots: {} });
    const a = await rescueDeadSite(lead(), audit(), d);
    expect(a.domain_status).toBe('expiring');
    expect(a.wayback_url).toBeNull();
    expect(a.site_description).toBeNull();
    expect(d.calls.filter((u) => u.includes('id_/'))).toHaveLength(0);
  });
  it('lookups that fail give unknown and never throw', async () => {
    const d: RescueDeps = { cacheDir: mkdtempSync(join(tmpdir(), 'rescue-')), pauseMs: 0, fetch: async () => { throw new Error('offline'); } };
    const a = await rescueDeadSite(lead(), audit(), d);
    expect(a.domain_status).toBe('unknown');
    expect(a.wayback_url).toBeNull();
    expect(a.rescued_at).toBeNull();
    const b = await rescueDeadSite(lead(), audit(), deps({ status: 404 }, wayback, new Error('archive down')));
    expect(b.domain_status).toBe('available');
    expect(b.wayback_url).toBeTruthy();
    expect(b.site_description).toBeNull();
  });
  it('a rate-limited or blocked archive read is not counted as done, so it is tried again next run', async () => {
    const blocked = { status: 200, body: 'Your request is being blocked because our system has flagged it as suspected abusive bot traffic that is degrading the performance of the Wayback Machine.' };
    const a = await rescueDeadSite(lead(), audit(), deps({ status: 404 }, wayback, blocked));
    expect(a.domain_status).toBe('available');
    expect(a.wayback_url).toBeTruthy();
    expect(a.site_description).toBeNull();
    expect(JSON.parse(a.emails_json ?? '[]')).toEqual([]);
    expect(a.rescued_at).toBeNull();
  });
  it('only dead sites, and only ones with a domain', async () => {
    const d = deps({ status: 404 }, wayback);
    const live = await rescueDeadSite(lead(), audit({ website_status: 'live' }), d);
    expect(live.domain_status).toBeNull();
    expect(d.calls).toHaveLength(0);
    const none = await rescueDeadSite(lead({ website_url: null }), audit({ final_domain: null, input_url: null }), d);
    expect(none.domain_status).toBe('unknown');
    expect(d.calls).toHaveLength(0);
  });
  it('caches a domain for a week, so the re-check before a pick costs nothing', async () => {
    const d = deps({ status: 404 }, wayback);
    await lookupDomain('acmeplumbing.co.uk', d);
    await lookupDomain('acmeplumbing.co.uk', d);
    expect(d.calls.filter((u) => u.startsWith('https://rdap.org/'))).toHaveLength(1);
  });
});

describe('unwrapArchiveHtml', () => {
  it('drops the toolbar and scripts and unwraps every archived URL', () => {
    const html = `<html><head><script src="https://web.archive.org/_static/js/bundle.js"></script><script>__wm.init("https://web.archive.org/web");</script></head>
<body><!-- BEGIN WAYBACK TOOLBAR INSERT --><div id="wm-ipp-base">Wayback Machine</div><!-- END WAYBACK TOOLBAR INSERT -->
<a href="https://web.archive.org/web/20250301120000/https://www.instagram.com/acme">ig</a><img src="/web/20250301120000im_/https://acme.co.uk/logo.png"><a href="mailto:hi@acme.co.uk">e</a></body></html>`;
    const out = unwrapArchiveHtml(html);
    expect(out).not.toMatch(/wm-ipp|__wm|_static/);
    expect(out).toContain('href="https://www.instagram.com/acme"');
    expect(out).toContain('src="https://acme.co.uk/logo.png"');
    expect(out).toContain('mailto:hi@acme.co.uk');
  });
});

describe('deadDomain', () => {
  it('prefers the audited domain, then the listing URL', () => {
    expect(deadDomain(lead(), audit({ final_domain: 'www.acmeplumbing.co.uk' }))).toBe('acmeplumbing.co.uk');
    expect(deadDomain(lead(), audit({ final_domain: null, input_url: null }))).toBe('acmeplumbing.co.uk');
    expect(deadDomain(lead({ website_url: 'localhost' }), audit({ final_domain: null, input_url: null }))).toBeNull();
  });
});
