import { describe, expect, it } from 'vitest';
import { bestQuote, describeLead } from '../src/report/describe.js';
import { cleanDescription } from '../src/audit/html-checks.js';
import { textQueries } from '../src/discover/index.js';
import { placeToLead } from '../src/discover/index.js';
import { parseQuery } from '../src/discover/parse-query.js';
import type { FullLead } from '../src/db/types.js';

const full = (lead: Record<string, unknown>, audit: Record<string, unknown> | null = null) => ({ lead: { area: 'Kings Heath', category_raw: 'barbers', type_label: 'Barber shop', editorial_summary: null, reviews_json: null, ...lead }, audit, ch: null, score: null, pipeline: {} } as unknown as FullLead);

describe('describeLead', () => {
  it('prefers Google, then the website, then reviews, then the listing', () => {
    expect(describeLead(full({ editorial_summary: 'Old-school barbers.' }, { site_description: 'x'.repeat(50) })).source).toBe('google');
    expect(describeLead(full({}, { site_description: 'Traditional and modern cuts in the heart of Kings Heath since 2012.' })).source).toBe('website');
    const reviews = JSON.stringify([{ rating: 5, text: 'Best skin fade I have had anywhere in Birmingham. Really friendly.', when: 'a month ago', at: '2026-08-01T00:00:00Z', author: 'Sam' }]);
    const d = describeLead(full({ reviews_json: reviews }));
    expect(d.source).toBe('reviews');
    expect(d.text).toContain('Barber shop in Kings Heath');
    expect(d.text).toContain('Best skin fade');
    expect(describeLead(full({})).source).toBe('listing');
  });
});

describe('bestQuote', () => {
  it('picks a specific good review over generic praise, skips low ratings', () => {
    const q = bestQuote([
      { rating: 5, text: 'Absolutely amazing, would recommend to anyone at all.', when: null, at: null, author: null },
      { rating: 5, text: 'Fixed our boiler the same day and kept the price he quoted.', when: null, at: null, author: null },
      { rating: 1, text: 'Terrible job on the boiler, never again, avoid at all costs.', when: null, at: null, author: null },
    ]);
    expect(q?.quote).toContain('Fixed our boiler');
  });
});

describe('cleanDescription', () => {
  it('drops template junk and very short text, trims long text', () => {
    expect(cleanDescription('Just another WordPress site')).toBeNull();
    expect(cleanDescription('Home')).toBeNull();
    expect(cleanDescription('Gas Safe plumbers covering Erdington and north Birmingham for 20 years.')).toContain('Gas Safe');
    expect(cleanDescription('word '.repeat(100))!.length).toBeLessThanOrEqual(300);
  });
});

describe('discovery', () => {
  it('adds category search terms only with --variants', () => {
    const p = parseQuery('plumbers in Erdington');
    expect(textQueries(p, false)).toEqual(['plumbers in Erdington, Birmingham, UK']);
    expect(textQueries(p, true)).toContain('heating engineer in Erdington, Birmingham, UK');
  });
  it('maps reviews and the latest review date from a Places result', () => {
    const lead = placeToLead({
      id: 'p1', displayName: { text: 'Acme' }, primaryTypeDisplayName: { text: 'Plumber' },
      reviews: [{ rating: 5, text: { text: 'Great' }, publishTime: '2025-01-01T00:00:00Z' }, { rating: 4, text: { text: 'Good' }, publishTime: '2026-07-01T00:00:00Z' }],
    }, parseQuery('plumbers in Erdington'));
    expect(lead.type_label).toBe('Plumber');
    expect(lead.last_review_at).toBe('2026-07-01T00:00:00Z');
    expect(JSON.parse(lead.reviews_json!)).toHaveLength(2);
    expect(lead.raw_json).not.toContain('Great');
  });
});
