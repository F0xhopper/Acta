import { describe, expect, it } from 'vitest';
import { PickSchema } from '../src/pick/config.js';
import { applyDiversity, buildability, filterCandidates, outcomeMultipliers } from '../src/pick/rules.js';
import type { FullLead } from '../src/db/types.js';

const cfg = PickSchema.parse({});
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let id = 1;
const lead = (over: Record<string, unknown> = {}, audit: Record<string, unknown> | null = {}, tier = 'A', ch: 'high' | 'none' = 'none'): FullLead => ({
  lead: { id: id++, slug: `s${id}`, name: `Biz ${id}`, category_key: 'barber', area: 'Kings Heath', rating: 4.8, review_count: 50, last_review_at: daysAgo(10), phone_e164: '+441210000000',
    photo_count: 8, editorial_summary: null, reviews_json: JSON.stringify([{ text: 'x'.repeat(50) }, { text: 'y'.repeat(50) }, { text: 'z'.repeat(50) }]), opening_hours_json: '["Mon"]', ...over } as never,
  audit: audit === null ? null : { website_status: 'none', audited_at: daysAgo(2), site_description: null, ...audit } as never,
  score: { tier, total: 90, excluded_reason: tier === 'X' ? 'Chain' : null } as never,
  ch: { match_confidence: ch } as never,
  pipeline: { status: 'new' } as never,
});

describe('buildability', () => {
  it('adds up what there is to build from', () => {
    expect(buildability(lead(), cfg).score).toBe(40 + 20 + 10);
    expect(buildability(lead({ photo_count: 0, reviews_json: '[]', opening_hours_json: null }), cfg).score).toBe(0);
    expect(buildability(lead({}, { website_status: 'live', site_description: 'd' }), cfg).score).toBe(40 + 15 + 15 + 20 + 10);
  });
});

describe('filterCandidates', () => {
  it('keeps a good tier A lead and explains every rejection', () => {
    const { eligible, skipped } = filterCandidates([
      lead(),
      lead({ review_count: 5 }),
      lead({ last_review_at: daysAgo(500) }),
      lead({ photo_count: 1 }),
      lead({ phone_e164: null }),
      lead({}, {}, 'B'),
      lead({}, { audited_at: daysAgo(40) }),
      lead({ category_key: 'unicorn-wrangler' }),
    ], cfg, new Set());
    expect(eligible).toHaveLength(1);
    expect(skipped.map((s) => s.why)).toEqual([
      expect.stringMatching(/5 reviews/), expect.stringMatching(/latest review/), expect.stringMatching(/1 photos/), expect.stringMatching(/no phone/),
      'tier B', expect.stringMatching(/audit is/), expect.stringMatching(/not configured/),
    ]);
  });
  it('lets a limited company through without a phone and gives it the bonus', () => {
    const { eligible } = filterCandidates([lead({ phone_e164: null }, {}, 'A', 'high'), lead()], cfg, new Set());
    expect(eligible).toHaveLength(2);
    expect(eligible[0].full.ch?.match_confidence).toBe('high');
  });
});

describe('applyDiversity', () => {
  it('caps per trade and area, one walk-in per area, and the weekly total', () => {
    const many = Array.from({ length: 6 }, () => lead());
    const { picked, skipped } = applyDiversity(filterCandidates(many, cfg, new Set()).eligible, cfg, [], 10);
    expect(picked).toHaveLength(1);                           // barbers are walk-in: one per area
    expect(skipped[0].why).toMatch(/walk-in/);
    const plumbers = Array.from({ length: 4 }, () => lead({ category_key: 'plumber', area: 'Erdington' }));
    const r2 = applyDiversity(filterCandidates(plumbers, cfg, new Set()).eligible, cfg, [], 10);
    expect(r2.picked).toHaveLength(2);
    const r3 = applyDiversity(filterCandidates(plumbers, cfg, new Set()).eligible, cfg, Array.from({ length: 10 }, () => ({ category_key: 'x', area: 'y' })), 10);
    expect(r3.picked).toHaveLength(0);
    expect(r3.skipped[0].why).toMatch(/weekly cap/);
  });
});

describe('outcomeMultipliers', () => {
  it('only learns from categories with five or more contacts and stays within bounds', () => {
    const { multipliers, overall } = outcomeMultipliers([{ category_key: 'barber', contacted: 10, positive: 6 }, { category_key: 'plumber', contacted: 10, positive: 0 }, { category_key: 'cafe', contacted: 2, positive: 2 }]);
    expect(overall).toBeCloseTo(8 / 22, 2);
    expect(multipliers.get('barber')).toBeGreaterThan(1);
    expect(multipliers.get('plumber')).toBeGreaterThanOrEqual(0.7);
    expect(multipliers.has('cafe')).toBe(false);
  });
});
