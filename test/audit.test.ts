import { describe, expect, it } from 'vitest';
import { auditLead, mergeChecks } from '../src/audit/index.js';
import type { FetchResult } from '../src/audit/fetch.js';
import type { RenderResult } from '../src/audit/screenshot.js';
import { expandAreas } from '../src/discover/areas.js';
import type { LeadRow } from '../src/db/types.js';

const lead = (url: string): LeadRow => ({
  id: 1, slug: 't', place_id: 'p', name: 'Acme', category_key: 'plumber', category_raw: 'plumbers', area: 'X', source_query: 'q', address: null, postcode: null,
  outward_code: 'B1', lat: null, lng: null, phone_e164: '+441211234567', website_url: url, google_maps_url: null, rating: 5, review_count: 20, business_status: 'OPERATIONAL',
  primary_type: null, types_json: null, opening_hours_json: null, is_chain: 0, raw_json: null, discovered_at: '', last_seen_at: '',
});
const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}${'<p>Real content about plumbing services in Birmingham.</p>'.repeat(10)}</body></html>`;
const fetched = (over: Partial<FetchResult>): FetchResult => ({
  inputUrl: '', finalUrl: 'https://acme.co.uk/', finalDomain: 'acme.co.uk', httpStatus: 200, tlsError: null, error: null, redirectCount: 0, redirectLoop: false,
  ttfbMs: 100, httpsOk: true, httpRedirectsToHttps: null, body: page('', ''), headers: {}, contentType: 'text/html', ...over,
});
const rendered = (over: Partial<RenderResult>): RenderResult => ({
  mobile: '/m.png', desktop: '/d.png', html: page('<meta name="viewport" content="width=device-width">', '<a href="tel:01211234567">Call</a>'),
  title: 'Acme Plumbing', text: 'Real content '.repeat(40), status: 200, finalUrl: 'https://acme.co.uk/', error: null, ...over,
});
const deps = (f: (url: string) => FetchResult, r: RenderResult) => ({
  fetchHomepage: async (url: string) => f(url),
  runPsi: async () => ({ perf: null, seo: null, a11y: null, bp: null, jsonPath: null, error: null }),
  renderSite: async () => r,
});
const opts = { psi: false };

describe('auditLead second opinion', () => {
  it('reads the viewport a JavaScript builder injects', async () => {
    const a = await auditLead(lead('https://acme.co.uk'), opts, deps(() => fetched({ body: page('', '<img src="https://static.wixstatic.com/x.jpg">') }), rendered({})));
    expect(a.website_status).toBe('live');
    expect(a.has_viewport).toBe(1);
    expect(a.builder).toBe('wix');
    expect(a.phone_matches_listing).toBe(1);
  });
  it('rescues a site that blocks scripts but loads for a person', async () => {
    const a = await auditLead(lead('https://acme.co.uk'), opts, deps(() => fetched({ httpStatus: 403, body: 'Forbidden' }), rendered({ status: 403 })));
    expect(a.website_status).toBe('live');
    expect(a.rendered_rescue).toBe(1);
  });
  it('does not rescue a bot challenge page', async () => {
    const a = await auditLead(lead('https://acme.co.uk'), opts, deps(() => fetched({ httpStatus: 403, body: 'Forbidden' }), rendered({ title: 'Just a moment...' })));
    expect(a.website_status).toBe('broken');
  });
  it('does not second-guess a dead domain', async () => {
    let rendersCalled = 0;
    const d = { ...deps(() => fetched({ httpStatus: null, error: 'ENOTFOUND', body: '' }), rendered({})), renderSite: async () => { rendersCalled++; return rendered({}); } };
    const a = await auditLead(lead('https://gone.co.uk'), opts, d);
    expect(a.website_status).toBe('down');
    expect(rendersCalled).toBe(0);
  });
  it('treats a dead listing link with a working homepage as live with a flag', async () => {
    const f = (url: string) => (url.endsWith('/birmingham') ? fetched({ httpStatus: 404, finalUrl: 'https://acme.co.uk/birmingham' }) : fetched({}));
    const a = await auditLead(lead('https://acme.co.uk/birmingham'), opts, deps(f, rendered({})));
    expect(a.website_status).toBe('live');
    expect(a.listing_link_broken).toBe(1);
    expect(a.final_url).toBe('https://acme.co.uk/');
  });
  it('keeps a genuinely missing site broken', async () => {
    const a = await auditLead(lead('https://acme.co.uk/'), opts, deps(() => fetched({ httpStatus: 404, finalUrl: 'https://acme.co.uk/' }), rendered({ status: 404 })));
    expect(a.website_status).toBe('broken');
  });
});

describe('mergeChecks', () => {
  it('treats no phones on the page as unknown, not a mismatch', () => {
    const base = { hasViewport: false, title: null, titleLen: 0, metaDescLen: 0, h1Count: 0, builder: null, freeTierHost: false, copyrightYear: null, phonesOnPage: [], phoneMatchesListing: null, hasLocalSchema: false, ltdHint: false };
    expect(mergeChecks(base, base, '+441211234567')?.phoneMatchesListing).toBeNull();
  });
});

describe('expandAreas', () => {
  it('fans a trade across a group or a list, dropping any area in the query', () => {
    const groups = { trades: ['Erdington', 'Kingstanding'] };
    expect(expandAreas('plumbers', 'trades', groups)).toEqual(['plumbers in Erdington', 'plumbers in Kingstanding']);
    expect(expandAreas('plumbers in Moseley', 'Harborne, Bearwood', groups)).toEqual(['plumbers in Harborne', 'plumbers in Bearwood']);
  });
});
