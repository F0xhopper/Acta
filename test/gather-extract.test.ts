import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BrandSchema, FactsSchema } from '../src/build/contracts.js';
import { colourWord, dominantColours, hexToHsl, toHex, voteColours } from '../src/build/gather/colours.js';
import { claimsFromReviews, extractAreas, extractClaims, extractServices, toneHints } from '../src/build/gather/facts.js';
import { extractFonts, firstFamily, googleFamilies } from '../src/build/gather/fonts.js';
import { buildBrand, buildFacts, type GatherInputs } from '../src/build/gather/index.js';
import { rankLogoCandidates } from '../src/build/gather/logo.js';
import { brandCssVars, parsePage } from '../src/build/gather/parse.js';
import { selectSitePhotos } from '../src/build/gather/photos.js';
import { looksLikeBadge } from '../src/build/gather/types.js';
import { originalAssetUrl } from '../src/build/gather/download.js';
import type { FullLead } from '../src/db/types.js';
import { researchQueries } from '../src/build/research.js';

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', 'gather', name), 'utf8');
const home = parsePage(fx('wix-home.html'), 'https://acmeplumbing.co.uk/');
const about = parsePage(fx('wp-about.html'), 'https://acmeplumbing.co.uk/about-us');

describe('parsePage', () => {
  it('finds images, icons, og:image, socials, emails, fonts, headings and css vars', () => {
    expect(home.images.find((i) => i.src.endsWith('acme-logo.png'))?.inHeader).toBe(true);
    expect(home.icons.some((i) => i.rel === 'apple-touch-icon')).toBe(true);
    expect(home.ogImage).toBe('https://static.wixstatic.com/media/hero-photo.jpg');
    expect(home.socialLinks).toHaveLength(2);
    expect(home.emails).toEqual(['hello@acmeplumbing.co.uk']);
    expect(home.fontLinks).toHaveLength(1);
    expect(home.headings).toContain('Boiler Installation');
    expect(home.cssVars['--color-primary']).toBe('#0b3d91');
    expect(brandCssVars(':root{--x-brand-main: rgb(1, 2, 3)}')['--x-brand-main']).toBe('rgb(1, 2, 3)');
  });
});

describe('logo ranking', () => {
  it('prefers the header logo and rejects supplier badges', () => {
    const r = rankLogoCandidates([home]);
    expect(r.candidates[0].url).toContain('acme-logo.png');
    expect(r.candidates[0].source).toBe('site_header');
    expect(r.candidates.some((c) => c.source === 'apple_touch_icon')).toBe(true);
    expect(r.rejected.map((x) => x.url).join(' ')).toMatch(/gas-safe|worcester/);
    expect(r.candidates.some((c) => /gas-safe|worcester/.test(c.url))).toBe(false);
  });
  it('badge detection is word-based', () => {
    expect(looksLikeBadge('https://x/gas-safe.png')).toBe(true);
    expect(looksLikeBadge('https://x/ideal-homes-logo.png')).toBe(true);
    expect(looksLikeBadge('https://x/acme-logo.png', 'Acme Plumbing logo')).toBe(false);
    expect(looksLikeBadge('https://x/barkingmad.png')).toBe(false);
  });
});

describe('colours', () => {
  it('parses css colours', () => {
    expect(toHex('#abc')).toBe('#aabbcc');
    expect(toHex('rgb(11, 61, 145)')).toBe('#0b3d91');
    expect(toHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(toHex('rgba(10, 20, 30, 0.9)')).toBe('#0a141e');
  });
  it('votes a palette and explains it', () => {
    const p = voteColours({ headerBg: '#0b3d91', buttonBg: '#f07814', navLink: '#ffffff', bodyText: '#222222', bodyBg: '#ffffff', logo: ['#0c3f95', '#f07814'] });
    expect(p.primary).toBe('#0b3d91');
    expect(p.confidence).toBe('high');
    expect(p.secondary).toBe('#f07814');
    expect(p.neutral).toBe('#222222');
    expect(p.notes[0]).toMatch(/header background.*confirmed by logo/);
  });
  it('falls back to the logo, then leaves it to the designer', () => {
    expect(voteColours({ headerBg: '#ffffff', logo: ['#8b0000'] }).primary).toBe('#8b0000');
    const none = voteColours({ headerBg: '#ffffff', bodyText: '#333333', photos: ['#3a7d44'] });
    expect(none.primary).toBeNull();
    expect(none.confidence).toBe('low');
    expect(none.notes[0]).toMatch(/photos lean green/);
  });
  it('finds dominant colours in an image', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 11, g: 61, b: 145, alpha: 1 } } }).png().toBuffer();
    const d = await dominantColours(png);
    expect(d[0].share).toBeGreaterThan(0.9);
    expect(hexToHsl(d[0].hex).h).toBeCloseTo(hexToHsl('#0b3d91').h, 0);
    expect(colourWord(d[0].hex)).toBe('navy');
  });
});

describe('asset urls', () => {
  it('upgrades builder thumbnails to originals', () => {
    expect(originalAssetUrl('https://static.wixstatic.com/media/28a6_abc~mv2.png/v1/fill/w_70,h_28,al_c/x.png')).toBe('https://static.wixstatic.com/media/28a6_abc~mv2.png');
    expect(originalAssetUrl('https://cdn.shopify.com/s/files/1/x/logo_300x.png?v=1')).toBe('https://cdn.shopify.com/s/files/1/x/logo.png?v=1');
    expect(originalAssetUrl('https://acme.co.uk/img/logo.png')).toBe('https://acme.co.uk/img/logo.png');
  });
});

describe('fonts', () => {
  it('reads google fonts and skips system faces', () => {
    expect(googleFamilies(home.fontLinks)).toEqual(['Poppins', 'Lora']);
    expect(firstFamily('"Poppins", Arial, sans-serif')).toBe('Poppins');
    expect(firstFamily('Arial, Helvetica, sans-serif')).toBeNull();
    expect(firstFamily('wfont_abc123_display, sans-serif')).toBeNull();
    expect(firstFamily('avenir-lt-w01_85-heavy1475544, sans-serif')).toBe('Avenir');
    expect(firstFamily('futura-lt-w01-book, sans-serif')).toBe('Futura');
    const f = extractFonts([{ ...home, styles: { header: { bg: null, color: null }, navLink: { color: null }, button: { bg: null, color: null }, h1: { fontFamily: '"Poppins", sans-serif', color: null }, body: { fontFamily: 'Lora, serif', color: null, bg: null } } }]);
    expect(f).toEqual({ heading: 'Poppins', body: 'Lora', google: ['Poppins', 'Lora'], source: 'site' });
  });
});

describe('facts extraction', () => {
  it('finds accreditations, years and offers with a quote and url', () => {
    const c = extractClaims(about.text, about.url);
    const names = c.map((x) => x.claim);
    expect(names).toContain('Gas Safe registered (No. 512345)');
    expect(names).toContain('Fully insured');
    expect(names).toContain('Established 2011');
    expect(names).toContain("20+ years' experience");
    expect(names).toContain('Family-run business');
    expect(names).toContain('Same-day service');
    expect(c[0].url).toBe(about.url);
    expect(c.find((x) => x.claim.startsWith('Gas Safe'))?.quote).toMatch(/512345/);
  });
  it('turns review themes into claims and tone hints', () => {
    const reviews = [{ text: 'Came out the same day and was really friendly. Fair price too, would recommend.', author: 'Dawn' }, { text: 'Professional and tidy work.', author: null }];
    const c = claimsFromReviews(reviews);
    expect(c.map((x) => x.claim)).toEqual(expect.arrayContaining(['Customers mention same-day service', 'Customers mention friendly service', 'Customers recommend them', 'Customers mention tidy work']));
    expect(c[0].source).toBe('review');
    expect(toneHints(reviews)).toEqual(expect.arrayContaining(['friendly', 'fair', 'recommend', 'professional', 'tidy']));
  });
  it('picks services from headings and falls back to the category', () => {
    const s = extractServices([home, about], 'plumber');
    expect(s.map((x) => x.name)).toEqual(expect.arrayContaining(['Boiler Installation', 'Bathroom Fitting', 'Emergency Leak Repair']));
    expect(s.some((x) => x.name === 'Why choose us' || x.name === 'Our Team')).toBe(false);
    expect(extractServices([{ ...home, headings: ['A CLEAR PLAN. REAL RESULTS', "WHAT'S INVOLVED?", 'SMALL GROUP TRAINING', 'Angie, 55, Witton', 'NUTRITION FRAMEWORK'], navTexts: [] }], 'personal_trainer').map((x) => x.name).slice(0, 2)).toEqual(['Small Group Training', 'Nutrition Framework']);
    const fallback = extractServices([], 'barber');
    expect(fallback[0]).toEqual({ name: 'Haircuts', source: 'category', evidence: null });
  });
  it('finds areas served', () => {
    expect(extractAreas(home.text + ' ' + about.text, 'Erdington')).toEqual(['Erdington', 'Sutton Coldfield', 'Kingstanding', 'Great Barr', 'Castle Bromwich']);
  });
});

describe('photos', () => {
  it('keeps big real photos, drops logos, badges and icons', () => {
    const picks = selectSitePhotos([home, about], ['https://static.wixstatic.com/media/acme-logo.png']);
    const srcs = picks.map((p) => p.src);
    expect(srcs).toContain('https://static.wixstatic.com/media/van-1.jpg');
    expect(srcs).toContain('https://acmeplumbing.co.uk/wp-content/uploads/team.jpg');
    expect(srcs.join(' ')).not.toMatch(/gas-safe|worcester|icon-tick|acme-logo/);
  });
});

const full: FullLead = {
  lead: {
    id: 1, slug: 'erdington-plumber-acme', place_id: 'p1', name: 'Acme Plumbing & Heating', category_key: 'plumber', category_raw: 'plumbers', area: 'Erdington', source_query: 'plumbers in Erdington',
    address: '1 High St, Erdington, Birmingham B23 6AA', postcode: 'B23 6AA', outward_code: 'B23', lat: null, lng: null, phone_e164: '+447700900123', website_url: 'https://acmeplumbing.co.uk', google_maps_url: 'https://maps.google.com/?cid=1',
    rating: 4.8, review_count: 41, business_status: 'OPERATIONAL', primary_type: 'plumber', types_json: '["plumber"]', opening_hours_json: '["Monday: 8:00 am – 6:00 pm"]', is_chain: 0, raw_json: null,
    discovered_at: '', last_seen_at: '', type_label: 'Plumber', editorial_summary: null, last_review_at: '2026-08-01T00:00:00Z', photo_count: null,
    reviews_json: JSON.stringify([{ rating: 5, text: 'Came out the same day, friendly and tidy. Recommend.', when: 'a month ago', at: '2026-08-01T00:00:00Z', author: 'Dawn' }]),
  },
  audit: { lead_id: 1, audited_at: '', run_id: null, website_status: 'live', input_url: null, final_url: 'https://acmeplumbing.co.uk/', final_domain: 'acmeplumbing.co.uk', http_status: 200, tls_error: null, redirect_count: 0, ttfb_ms: 300, https_ok: 1, http_redirects_to_https: null, has_viewport: 0, title: 'Acme Plumbing', title_len: 13, meta_desc_len: 0, h1_count: 1, builder: 'wix', free_tier_host: 0, copyright_year: 2018, phone_on_page: '+447700900123', phone_matches_listing: 1, has_local_schema: 0, ltd_hint: 1, lh_perf: 41, lh_seo: 80, lh_a11y: 80, lh_bp: 80, lh_error: null, lh_json_path: null, screenshot_mobile: null, screenshot_desktop: null, error: null },
  ch: null, score: null,
  pipeline: { lead_id: 1, status: 'new', channel: null, contacted_at: null, last_touch_at: null, next_touch_at: null, notes: null, updated_at: '' },
};

const inputs: GatherInputs = {
  full, pages: [{ ...home, styles: { header: { bg: 'rgb(11, 61, 145)', color: 'rgb(255,255,255)' }, navLink: { color: 'rgb(255,255,255)' }, button: { bg: 'rgb(240, 120, 20)', color: '#fff' }, h1: { fontFamily: 'Poppins, sans-serif', color: '#0b3d91' }, body: { fontFamily: 'Lora, serif', color: 'rgb(34,34,34)', bg: 'rgb(255,255,255)' } } }, about],
  details: { goodForChildren: true, paymentOptions: { acceptsCreditCards: true }, editorialSummary: { text: 'Local plumbers since 2011.' } },
  logo: { path: '/tmp/logo.png', format: 'png', width: 220, height: 80, quality: 'raster_ok', source: 'site_header', source_url: 'https://static.wixstatic.com/media/acme-logo.png' },
  logoColours: ['#0c3f95', '#f07814'],
  photos: [{ path: '/tmp/site-1.jpg', source: 'site', width: 1200, height: 800, attribution: null, alt: 'Our van', page_url: 'https://acmeplumbing.co.uk/' }],
  photoColours: ['#3a3a3a'],
  competitors: [{ name: 'Rival Plumbing', url: 'https://rival.co.uk/', screenshot: null, notes: null }],
  company: { number: '07654321', name: 'ACME PLUMBING LTD', incorporated: '2011-03-14', status: 'active' },
  notes: [],
};

describe('assembly', () => {
  it('builds a brand that validates', () => {
    const b = buildBrand(inputs);
    expect(() => BrandSchema.parse(b)).not.toThrow();
    expect(b.palette.primary).toBe('#0b3d91');
    expect(b.palette.confidence).toBe('high');
    expect(b.fonts.heading).toBe('Poppins');
    expect(b.social.instagram).toContain('instagram.com');
    expect(b.tone_hints).toContain('friendly');
    expect(b.existing_site.drop).toEqual(expect.arrayContaining(['no mobile viewport', 'copyright 2018']));
    expect(b.existing_site.keep[0]).toMatch(/07700 900123/);
    expect(b.quality.upsells).toContain('Replace stock images with your own photos');
    expect(b.quality.upsells).not.toContain('Redraw the logo as a clean vector');
  });
  it('builds facts that validate, with evidence and a company', () => {
    const f = buildFacts(inputs);
    expect(() => FactsSchema.parse(f)).not.toThrow();
    expect(f.business.whatsapp).toBe('https://wa.me/447700900123');
    expect(f.business.email).toBe('hello@acmeplumbing.co.uk');
    expect(f.business.description).toBe('Local plumbers since 2011.');
    expect(f.company?.incorporated).toBe('2011-03-14');
    expect(f.claims.map((c) => c.claim)).toEqual(expect.arrayContaining(['Established 2011', 'Limited company since 2011', 'Fully insured', 'Customers mention same-day service']));
    expect(f.claims.filter((c) => c.claim === 'Established 2011')).toHaveLength(1);
    expect(f.attributes).toEqual({ card_payments: true, kids: true });
    expect(f.areas[0]).toBe('Erdington');
    expect(f.must_haves.length).toBeGreaterThan(0);
    expect(f.competitors[0].name).toBe('Rival Plumbing');
  });
  it('builds research queries from the brand', () => {
    const q = researchQueries(buildBrand(inputs), buildFacts(inputs));
    expect(q[0]).toBe('plumber website design navy');
    expect(q).toHaveLength(3);
  });
});

import { looksLikeGoogleBadge } from '../src/build/gather/download.js';

describe('logo safety', () => {
  it('rejects a Google-coloured review badge and accepts a one-colour mark', async () => {
    const badge = await sharp(Buffer.from('<svg width="200" height="80"><rect width="50" height="80" fill="#4285F4"/><rect x="50" width="50" height="80" fill="#EA4335"/><rect x="100" width="50" height="80" fill="#FBBC05"/><rect x="150" width="50" height="80" fill="#34A853"/></svg>')).png().toBuffer();
    const mark = await sharp(Buffer.from('<svg width="200" height="80"><rect width="200" height="80" fill="#0b3d91"/><circle cx="100" cy="40" r="30" fill="#fff"/></svg>')).png().toBuffer();
    expect(await looksLikeGoogleBadge(badge)).toBe(true);
    expect(await looksLikeGoogleBadge(mark)).toBe(false);
  });
  it('prefers the touch icon over a crowd of anonymous header images', () => {
    const img = (src: string) => ({ src, alt: '', title: null, className: '', nearText: '', width: 0, height: 0, inHeader: true });
    const pages = [{ url: 'https://x.co.uk/', html: '', text: '', images: [img('https://x.co.uk/a.png'), img('https://x.co.uk/b.png'), img('https://x.co.uk/c.png')], icons: [{ rel: 'apple-touch-icon', href: 'https://x.co.uk/touch.png', sizes: '180x180' }], ogImage: null }];
    const r = rankLogoCandidates(pages as never);
    expect(r.candidates[0].source).toBe('apple_touch_icon');
  });
});

import { isBrandLike } from '../src/build/gather/colours.js';
describe('brand colours', () => {
  it('ignores browser default link colours', () => {
    expect(isBrandLike('#0000ee')).toBe(false);
    expect(isBrandLike('#0b3d91')).toBe(true);
  });
});
