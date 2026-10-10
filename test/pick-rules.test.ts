import { describe, expect, it } from 'vitest';
import { PickSchema } from '../src/pick/config.js';
import { applyDiversity, buildability, filterCandidates } from '../src/pick/rules.js';
import { learning, sweepWeight, tradeValue } from '../src/pick/trade.js';
import { findCategory } from '../src/config.js';
import type { FullLead } from '../src/db/types.js';

const cfg = PickSchema.parse({});
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let id = 1;
/** By default a lead that passes every gate: a roofer with no site, established, a limited company with an email, enough to build from. */
const lead = (over: Record<string, unknown> = {}, audit: Record<string, unknown> | null = {}, tier = 'A', ch: 'high' | 'none' = 'high'): FullLead => ({
  lead: { id: id++, slug: `s${id}`, name: `Biz ${id}`, category_key: 'roofer', area: 'Kings Heath', rating: 4.8, review_count: 50, last_review_at: daysAgo(10), phone_e164: '+441210000000',
    address: '1 High St, Birmingham B14 7AA', manual_email: 'owner@biz.co.uk',
    photo_count: 8, editorial_summary: null, reviews_json: JSON.stringify([{ text: 'x'.repeat(50) }, { text: 'y'.repeat(50) }, { text: 'z'.repeat(50) }]), opening_hours_json: '["Mon"]', ...over } as never,
  audit: audit === null ? null : { website_status: 'none', audited_at: daysAgo(2), site_description: null, ...audit } as never,
  score: { tier, total: 90, opportunity: 100, excluded_reason: tier === 'X' ? 'Chain' : null } as never,
  ch: { match_confidence: ch } as never,
  pipeline: { status: 'new' } as never,
});

describe('buildability', () => {
  it('is the content score: more to build from scores higher', () => {
    const rich = buildability(lead({}, { website_status: 'live', site_description: 'd' })).score;
    const bare = buildability(lead({ photo_count: 0, reviews_json: '[]', opening_hours_json: null, address: null })).score;
    expect(rich).toBeGreaterThan(70);
    expect(bare).toBeLessThan(20);
  });
});

describe('filterCandidates', () => {
  it('passes a lead that clears every gate, keeps one-gate-short leads as near misses, and explains the rest', () => {
    const decentSite = lead({}, { website_status: 'live' });
    (decentSite.score as { opportunity: number }).opportunity = 20;
    const { eligible, near, skipped } = filterCandidates([
      lead(),
      lead({ manual_email: null }),                          // near: no email
      lead({ category_key: 'barber' }),                      // near: a low-value trade never displaces a roofer build
      lead({ category_key: 'takeaway' }),                    // near: a trade that rarely pays for a site
      lead({ category_key: 'takeaway', manual_email: null }), // fails two gates
      lead({ review_count: 5 }),                             // near: not established
      lead({}, {}, 'X'),                                     // excluded outright
      decentSite,                                            // near: has a decent site
    ], cfg, new Set());
    expect(eligible.map((c) => c.full.lead.category_key)).toEqual(['roofer']);
    expect(near.map((c) => c.grade.failed.map((g) => g.key).join()).sort()).toEqual(['established', 'gap', 'reach', 'trade', 'trade']);
    expect(skipped.find((s) => s.gates?.length === 2)?.gates).toEqual(['Pays for a site', 'Reachable']);
    expect(skipped.find((s) => s.gates?.includes('Eligible'))?.why).toMatch(/Chain/);
  });
  it('a limited company with no email is told where to look', () => {
    const { near } = filterCandidates([lead({ manual_email: null })], cfg, new Set());
    expect(near[0].grade.failed[0].detail).toMatch(/Facebook/);
  });
  it('passes a mobile with no email (call, then WhatsApp the link), unless the gate asks for cold email only', () => {
    const mobile = () => lead({ manual_email: null, phone_e164: '+447700900123' }, {}, 'A', 'none');
    expect(filterCandidates([mobile()], cfg, new Set()).eligible).toHaveLength(1);
    const strict = PickSchema.parse({ gates: { reach: ['cold_email'] } });
    const r = filterCandidates([mobile()], strict, new Set());
    expect(r.near[0].grade.failed[0].key).toBe('reach');
  });
  it('a landline with no email has nowhere to send the link', () => {
    const { near } = filterCandidates([lead({ manual_email: null }, {}, 'A', 'none')], cfg, new Set());
    expect(near[0].grade.failed[0].short).toBe('Landline only');
  });
  it('ranks a cold-emailable lead above a call-first one, and skips stale audits for auto-pick', () => {
    const loose = PickSchema.parse({ gates: { reach: ['cold_email', 'email', 'mobile', 'social', 'landline'] } });
    const { eligible } = filterCandidates([lead({ manual_email: null }), lead()], loose, new Set());
    expect(eligible[0].full.lead.manual_email).toBe('owner@biz.co.uk');
    const stale = filterCandidates([lead({}, { audited_at: daysAgo(40) })], cfg, new Set(), undefined, { freshDays: 30 });
    expect(stale.skipped[0].why).toMatch(/audit is/);
  });
});

describe('the buyer lane', () => {
  const weakWix = (over: Record<string, unknown> = {}) => lead({ ...over }, { website_status: 'live', builder: 'wix', lh_perf: 45, site_description: 'd' });
  it('a live site that shows its age passes the gap gate in a trade worth replacing it for', () => {
    const roofer = weakWix();
    (roofer.score as { opportunity: number }).opportunity = 30;
    const r = filterCandidates([roofer], cfg, new Set());
    expect(r.eligible).toHaveLength(1);
    expect(r.eligible[0].grade.gates.find((g) => g.key === 'gap')?.detail).toMatch(/already pays for one/);
    expect(r.eligible[0].grade.parts.find((p) => p.key === 'gap')?.points).toBe(10);   // counted as at least the gap threshold
  });
  it('but not in a trade below the buyer-lane value', () => {
    const cleaner = weakWix({ category_key: 'cleaner' });   // 55: passes the trade gate, under the buyer lane's 70
    (cleaner.score as { opportunity: number }).opportunity = 30;
    const r = filterCandidates([cleaner], cfg, new Set());
    expect(r.near[0].grade.failed[0].key).toBe('gap');
    expect(r.near[0].grade.failed[0].detail).toMatch(/under the 70/);
  });
  it('a decent live site still fails the gap gate', () => {
    const fine = lead({}, { website_status: 'live', lh_perf: 90, has_viewport: 1, https_ok: 1, site_description: 'd' });
    (fine.score as { opportunity: number }).opportunity = 10;
    expect(filterCandidates([fine], cfg, new Set()).near[0].grade.failed[0].detail).toMatch(/a decent one/);
  });
});

describe('activity and means', () => {
  it('review dates only count under 30 reviews; reviews gained between sightings count at any size', () => {
    const busyOld = lead({ review_count: 120, last_review_at: daysAgo(600) });
    expect(filterCandidates([busyOld], cfg, new Set()).eligible).toHaveLength(1);
    const est = filterCandidates([busyOld], cfg, new Set()).eligible[0].grade.gates.find((g) => g.key === 'established')!;
    expect(est.detail).toMatch(/dates not counted/);
    const smallOld = lead({ review_count: 20, last_review_at: daysAgo(600) });
    expect(filterCandidates([smallOld], cfg, new Set()).near[0].grade.failed[0].key).toBe('established');
    const smallOldButGrowing = { ...smallOld, velocity: { gained: 3, days: 40, firstAt: daysAgo(40), lastAt: daysAgo(1), sightings: 2 } };
    const g = filterCandidates([smallOldButGrowing], cfg, new Set()).eligible[0].grade;
    expect(g.gates.find((x) => x.key === 'established')?.detail).toMatch(/3 new reviews/);
    expect(g.parts.find((p) => p.key === 'reputation')!.points).toBeGreaterThan(filterCandidates([busyOld], cfg, new Set()).eligible[0].grade.parts.find((p) => p.key === 'reputation')!.points - 5);
  });
  it('a young limited company scores more on means; a mobile beats a landline on reach', () => {
    const old = lead();
    (old.ch as { date_of_creation: string }).date_of_creation = '2005-03-01';
    const young = lead();
    (young.ch as { date_of_creation: string }).date_of_creation = new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const means = (f: FullLead) => filterCandidates([f], cfg, new Set()).eligible[0].grade.parts.find((p) => p.key === 'means')!;
    expect(means(young).points).toBeGreaterThan(means(old).points);
    expect(means(young).detail).toMatch(/buying years/);
    const reach = (f: FullLead) => filterCandidates([f], cfg, new Set()).eligible[0].grade.parts.find((p) => p.key === 'reach')!.points;
    expect(reach(lead({ manual_email: null, phone_e164: '+447700900123' }, {}, 'A', 'none'))).toBeGreaterThan(reach(lead({ manual_email: 'a@b.com', phone_e164: '+441210000000' }, {}, 'A', 'none')));
  });
});

describe('applyDiversity', () => {
  it('caps per trade and area, one walk-in per area, and the weekly total', () => {
    const anyTrade = PickSchema.parse({ gates: { min_trade_value: 0 } });
    const many = Array.from({ length: 6 }, () => lead({ category_key: 'barber' }));
    const { picked, skipped } = applyDiversity(filterCandidates(many, anyTrade, new Set()).eligible, cfg, [], 10);
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

describe('trade value', () => {
  const roofer = findCategory('roofer');
  const stats = [{ category_key: 'roofer', contacted: 10, positive: 0 }, { category_key: 'barber', contacted: 10, positive: 4 }];
  it('is the guess until there are pitches to learn from', () => {
    expect(tradeValue(roofer, learning([]), cfg).value).toBe(95);
    expect(tradeValue(roofer, learning([{ category_key: 'roofer', contacted: 5, positive: 0 }]), cfg).value).toBe(95);   // nobody has replied anywhere yet
  });
  it('moves towards your results: a trade that never replies sinks, one that replies often rises', () => {
    const l = learning(stats);
    const r = tradeValue(roofer, l, cfg);
    expect(r.value).toBeLessThan(60);
    expect(r.detail).toMatch(/guessed 95; 0 of 10/);
    expect(tradeValue(findCategory('barber'), l, cfg).value).toBeGreaterThan(30);
  });
  it('a proven trade gets through the gate it would have failed, and weaker trades count less in the sweep', () => {
    const cafe = lead({ category_key: 'cafe' });   // guessed 40, under the gate's 50
    expect(filterCandidates([cafe], cfg, new Set()).eligible).toHaveLength(0);
    const proven = learning([{ category_key: 'cafe', contacted: 20, positive: 12 }, { category_key: 'roofer', contacted: 20, positive: 4 }]);   // cafes reply at 1.5x the average
    expect(filterCandidates([lead({ category_key: 'cafe' })], cfg, new Set(), proven).eligible).toHaveLength(1);
    expect(sweepWeight(tradeValue(roofer, learning([]), cfg), cfg)).toBe(1);
    expect(sweepWeight(tradeValue(findCategory('barber'), learning([]), cfg), cfg)).toBeCloseTo(0.4, 1);
  });
});
