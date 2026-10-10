import { describe, expect, it } from 'vitest';
import { contentOf } from '../src/score/content.js';
import { findCategory } from '../src/config.js';
import type { FullLead } from '../src/db/types.js';

const reviews = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ text: `Great cut every time, friendly staff and fair prices ${i}` })));
const full = (lead: Record<string, unknown>, audit: Record<string, unknown> | null = { website_status: 'none' }): FullLead => ({
  lead: { id: 1, slug: 's', name: 'Biz', category_key: 'barber', area: 'Moseley', phone_e164: '+447700900000', address: '1 High St', website_url: null,
    photo_count: 10, editorial_summary: null, reviews_json: reviews(5), review_count: 200, opening_hours_json: '["Mon"]', manual_email: null, ...lead } as never,
  audit: audit as never, score: null as never, ch: null as never, pipeline: { status: 'new' } as never,
});
const barber = findCategory('barber');

describe('contentOf', () => {
  it('a live site with photos and reviews has plenty', () => {
    const c = contentOf(full({ editorial_summary: 'Barbers since 1990' }, { website_status: 'live', final_domain: 'biz.co.uk', site_description: 'x' }), barber);
    expect(c.level).toBe('plenty');
    expect(c.score).toBeGreaterThanOrEqual(90);
    expect(c.makeUp).toEqual([]);
  });
  it('no site: photos and reviews from Google, services and logo made up', () => {
    const c = contentOf(full({}), barber);
    const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
    expect(by.photos.detail).toBe('10+ on Google');
    expect(by.services.have).toBe('no');
    expect(by.logo.have).toBe('no');
    expect(by.about.have).toBe('some');
    expect(c.makeUp).toContain('Logo: none, a wordmark would be designed');
    expect(c.makeUp.some((m) => /Services and prices/.test(m))).toBe(true);
  });
  it('a booking platform gives prices, a social page gives a logo to redraw', () => {
    const fresha = contentOf(full({ website_url: 'https://www.fresha.com/a/biz' }, { website_status: 'platform_only', final_domain: 'www.fresha.com' }), barber);
    expect(fresha.items.find((i) => i.key === 'services')!.detail).toBe('Price list on Fresha');
    const insta = contentOf(full({ website_url: 'https://instagram.com/biz' }, { website_status: 'facebook_only', final_domain: 'instagram.com' }), barber);
    expect(insta.items.find((i) => i.key === 'logo')!.have).toBe('some');
    expect(insta.items.find((i) => i.key === 'photos')!.detail).toMatch(/Instagram \(ask to use\)/);
  });
  it('a dead site with an archived copy gives a logo, services and words to build from, a little stale', () => {
    const archived = full({}, { website_status: 'down', final_domain: 'biz.co.uk', wayback_url: 'https://web.archive.org/web/20260612230259/https://biz.co.uk/', wayback_at: '2026-06-12T23:02:59Z', site_description: 'Barbers in Moseley since 1990' });
    const c = contentOf(archived, barber);
    const by = Object.fromEntries(c.items.map((i) => [i.key, i]));
    expect(by.logo.have).toBe('yes');
    expect(by.logo.detail).toBe('From their old site (archived copy from Jun 2026)');
    expect(by.logo.points).toBe(8);
    expect(by.services.have).toBe('yes');
    expect(by.services.detail).toMatch(/^Their old site \(archived copy from Jun 2026\)/);
    expect(by.about.detail).toBe('Their old site (archived copy from Jun 2026)');
    expect(by.photos.detail).toContain('their old site (archived copy from Jun 2026)');
    expect(c.makeUp.some((m) => /Logo|Services/.test(m))).toBe(false);
    const dead = contentOf(full({}, { website_status: 'down', final_domain: 'biz.co.uk' }), barber);
    expect(c.score).toBeGreaterThan(dead.score);
    // A live site counts in full; the copy only matters when the site is gone.
    const live = contentOf(full({}, { website_status: 'live', final_domain: 'biz.co.uk', site_description: 'x', wayback_url: 'https://web.archive.org/web/1/https://biz.co.uk/' }), barber);
    expect(live.items.find((i) => i.key === 'logo')!.detail).toBe('From their website');
  });
  it('nothing at all is mostly made up', () => {
    const c = contentOf(full({ photo_count: 0, reviews_json: '[]', review_count: 0, opening_hours_json: null, address: null }), barber);
    expect(c.level).toBe('little');
    expect(c.makeUp).toContain('Photos: none to use, stock or generated throughout');
  });
});
