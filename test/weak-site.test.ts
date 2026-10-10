import { describe, expect, it } from 'vitest';
import { loadScoring } from '../src/config.js';
import { weakSiteSignals, weakSiteSummary } from '../src/score/weak-site.js';
import type { AuditRow } from '../src/db/types.js';

const scoring = loadScoring();
const audit = (over: Partial<AuditRow>): AuditRow => ({ website_status: 'live', has_viewport: 1, https_ok: 1, lh_perf: 80, builder: null, free_tier_host: 0, copyright_year: null, ...over } as AuditRow);

describe('weakSiteSignals', () => {
  it('names each sign a live site shows its age', () => {
    const keys = weakSiteSignals(audit({ has_viewport: 0, https_ok: 0, lh_perf: 30, builder: 'wix', free_tier_host: 1, copyright_year: 2020 }), scoring, new Date('2026-10-10')).map((s) => s.key);
    expect(keys).toEqual(['no_viewport', 'no_https', 'slow', 'cheap_builder', 'free_tier', 'stale']);
  });
  it('a modern site shows none; a dead site is not a weak live site', () => {
    expect(weakSiteSignals(audit({}), scoring)).toEqual([]);
    expect(weakSiteSignals(audit({ builder: 'wordpress', lh_perf: 55 }), scoring)).toEqual([]);
    expect(weakSiteSignals(audit({ website_status: 'down', builder: 'wix' }), scoring)).toEqual([]);
    expect(weakSiteSignals(null, scoring)).toEqual([]);
  });
  it('reads as a list', () => {
    expect(weakSiteSummary(weakSiteSignals(audit({ builder: 'godaddy', copyright_year: 2021 }), scoring, new Date('2026-10-10')))).toBe('built on godaddy, untouched since 2021');
  });
});
