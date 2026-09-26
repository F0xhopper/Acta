import { describe, expect, it } from 'vitest';
import { loadScoring, findCategory } from '../src/config.js';
import { scoreLead } from '../src/score/score.js';
import type { AuditRow, FullLead, LeadRow } from '../src/db/types.js';

const scoring = loadScoring();
const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: 1, slug: 'x', place_id: 'p1', name: 'Acme', category_key: 'plumber', category_raw: 'plumbers', area: 'Erdington', source_query: 'q', address: 'B23', postcode: 'B23 6QQ', outward_code: 'B23',
  lat: null, lng: null, phone_e164: '+441211234567', website_url: null, google_maps_url: null, rating: 4.8, review_count: 40, business_status: 'OPERATIONAL', primary_type: null, types_json: null,
  opening_hours_json: '["Mon: 9-5"]', is_chain: 0, raw_json: null, discovered_at: '', last_seen_at: '', ...over,
});
const audit = (over: Partial<AuditRow> = {}): AuditRow => ({
  lead_id: 1, audited_at: '', run_id: null, website_status: 'none', input_url: null, final_url: null, final_domain: null, http_status: null, tls_error: null, redirect_count: null, ttfb_ms: null,
  https_ok: null, http_redirects_to_https: null, has_viewport: null, title: null, title_len: null, meta_desc_len: null, h1_count: null, builder: null, free_tier_host: null, copyright_year: null,
  phone_on_page: null, phone_matches_listing: null, has_local_schema: null, ltd_hint: null, lh_perf: null, lh_seo: null, lh_a11y: null, lh_bp: null, lh_error: null, lh_json_path: null,
  screenshot_mobile: null, screenshot_desktop: null, error: null, ...over,
});
const full = (l: Partial<LeadRow> = {}, a: Partial<AuditRow> | null = {}, ch: 'high' | 'none' = 'none'): FullLead => ({
  lead: lead(l), audit: a === null ? null : audit(a), score: null,
  ch: { lead_id: 1, company_number: null, company_name: null, company_status: null, company_type: null, registered_postcode: null, sic_codes_json: null, match_confidence: ch, ltd_hint_from_site: 0, matched_at: '' },
  pipeline: { lead_id: 1, status: 'new', channel: null, contacted_at: null, last_touch_at: null, next_touch_at: null, notes: null, updated_at: '' },
});
const cat = findCategory('plumber');

describe('scoreLead', () => {
  it('no website, well reviewed plumber is tier A with phone channel', () => {
    const s = scoreLead(full(), scoring, cat);
    expect(s.opportunity).toBe(100); expect(s.tier).toBe('A'); expect(s.channel).toBe('phone');
    expect(s.viability).toBe(35 + 15 + 5 + 10 + 15);
    expect(JSON.parse(s.reasons_json)[0]).toBe('No website on Google listing');
  });
  it('limited company gets email channel and a viability bump', () => {
    const s = scoreLead(full({}, {}, 'high'), scoring, cat);
    expect(s.channel).toBe('email'); expect(s.viability).toBe(35 + 15 + 5 + 10 + 15 + 10);
  });
  it('adequate live site is excluded', () => {
    const s = scoreLead(full({}, { website_status: 'live', https_ok: 1, has_viewport: 1, lh_perf: 92, lh_seo: 95, has_local_schema: 1, title: 'Acme', meta_desc_len: 50, phone_matches_listing: 1 }), scoring, cat);
    expect(s.tier).toBe('X'); expect(s.excluded_reason).toBe('Site is adequate');
  });
  it('bad live site is tier B with reasons', () => {
    const s = scoreLead(full({}, { website_status: 'live', https_ok: 0, has_viewport: 0, lh_perf: 25, builder: 'wix', copyright_year: 2017, title: 'x', meta_desc_len: 10, has_local_schema: 0 }), scoring, cat);
    expect(s.opportunity).toBe(100); expect(s.tier).toBe('B');
    expect(JSON.parse(s.reasons_json)).toContain('No HTTPS');
  });
  it('chains, closed businesses and unaudited leads are excluded', () => {
    expect(scoreLead(full({ is_chain: 1 }), scoring, cat).excluded_reason).toBe('Chain or franchise');
    expect(scoreLead(full({ business_status: 'CLOSED_PERMANENTLY' }), scoring, cat).excluded_reason).toMatch(/Not operational/);
    expect(scoreLead(full({}, null), scoring, cat).excluded_reason).toBe('Not audited yet');
  });
  it('few reviews and no phone sink viability below the floor', () => {
    const s = scoreLead(full({ review_count: 2, rating: null, phone_e164: null, opening_hours_json: null }), scoring, cat);
    expect(s.viability).toBeLessThan(scoring.thresholds.min_viability); expect(s.tier).toBe('X');
  });
  it('excludes stations, hotels and other non-customers by place type', () => {
    expect(scoreLead(full({ primary_type: 'bus_station' }), scoring, cat).excluded_reason).toMatch(/Not a pitchable business type/);
    expect(scoreLead(full({ primary_type: 'point_of_interest', types_json: '["lodging","point_of_interest"]' }), scoring, cat).excluded_reason).toMatch(/lodging/);
    expect(scoreLead(full({ primary_type: 'plumber', types_json: '["plumber","point_of_interest"]' }), scoring, cat).excluded_reason).toBeNull();
  });
  it('excludes poor reputations outright and exact-name chains', () => {
    expect(scoreLead(full({ rating: 2.2, review_count: 183 }), scoring, cat).excluded_reason).toMatch(/Poor reputation/);
    expect(scoreLead(full({ rating: 2.2, review_count: 12 }), scoring, cat).excluded_reason).not.toMatch(/Poor reputation/);
    expect(scoreLead(full({ name: 'Coach' }), scoring, cat).excluded_reason).toBe('Chain or franchise');
    expect(scoreLead(full({ name: 'Coach Hire Plus' }), scoring, cat).excluded_reason).toBeNull();
    expect(scoreLead(full({ name: 'PureGym Birmingham Snow Hill' }), scoring, cat).excluded_reason).toBe('Chain or franchise');
  });
  it('tier A needs at least ten reviews', () => {
    const s = scoreLead(full({ review_count: 6, rating: 5 }), scoring, cat);
    expect(s.tier).toBe('C'); expect(s.viability).toBeGreaterThanOrEqual(scoring.thresholds.tier_min_viability);
  });
  it('walk-in categories route to walk_in', () => {
    const s = scoreLead(full({ category_key: 'barber' }), scoring, findCategory('barber'));
    expect(s.channel).toBe('walk_in');
  });
});
