import { describe, expect, it } from 'vitest';
import { isBotUserAgent, opensLine, parseOpens } from '../src/outreach/opens.js';
import { hookKind } from '../src/outreach/hook.js';
import { formatStats, outreachStats, tally, type PitchFact } from '../src/outreach/stats.js';

describe('preview opens', () => {
  it('never counts automation or link-preview fetchers', () => {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Chrome-Lighthouse', 'HeadlessChrome/120', 'WhatsApp/2.23.20', 'facebookexternalhit/1.1', 'curl/8.1', 'node-fetch', 'Slackbot-LinkExpanding']) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
  });
  it('reads the three counters from an Upstash pipeline reply, tolerating nulls', () => {
    expect(parseOpens([{ result: '3' }, { result: '2026-10-10T09:00:00.000Z' }, { result: '2026-10-11T12:30:00.000Z' }])).toEqual({ opens: 3, firstAt: '2026-10-10T09:00:00.000Z', lastAt: '2026-10-11T12:30:00.000Z' });
    expect(parseOpens([{ result: null }, { result: null }, { result: null }])).toEqual({ opens: 0, firstAt: null, lastAt: null });
    expect(parseOpens('nonsense')).toEqual({ opens: 0, firstAt: null, lastAt: null });
    expect(parseOpens([{ result: 'x' }, { result: 'not a date' }])).toEqual({ opens: 0, firstAt: null, lastAt: null });
  });
  it('says it plainly', () => {
    expect(opensLine(null, false)).toMatch(/UPSTASH_REDIS_REST_URL/);
    expect(opensLine(null, true)).toBe('Not opened yet');
    expect(opensLine({ opens: 1, firstAt: null, lastAt: null, checkedAt: '' }, true)).toBe('Preview opened once');
    expect(opensLine({ opens: 3, firstAt: null, lastAt: '2026-10-11T12:30:00.000Z', checkedAt: '' }, true)).toBe('Preview opened 3 times, last 2026-10-11');
  });
});

describe('hookKind', () => {
  const live = (over: Record<string, unknown>) => ({ website_status: 'live' as const, has_viewport: 1, lh_perf: 80, https_ok: 1, builder: null, copyright_year: null, ...over });
  it('uses the website status for anything that is not a live site', () => {
    expect(hookKind({ ...live({}), website_status: 'none' })).toBe('none');
    expect(hookKind({ ...live({}), website_status: 'down' })).toBe('down');
    expect(hookKind({ ...live({}), website_status: 'facebook_only' })).toBe('facebook_only');
    expect(hookKind(null)).toBe('unknown');
  });
  it('picks the strongest weakness of a live site, in the order the pitch would lead with', () => {
    expect(hookKind(live({ has_viewport: 0, lh_perf: 20 }))).toBe('no_viewport');
    expect(hookKind(live({ lh_perf: 40, https_ok: 0 }))).toBe('slow');
    expect(hookKind(live({ https_ok: 0, builder: 'wix' }))).toBe('no_https');
    expect(hookKind(live({ builder: 'wix', copyright_year: 2019 }), 2026)).toBe('cheap_builder');
    expect(hookKind(live({ builder: 'wordpress', copyright_year: 2022 }), 2026)).toBe('stale');
    expect(hookKind(live({ builder: 'wordpress', copyright_year: 2025 }), 2026)).toBe('weak');
  });
});

describe('outreach stats', () => {
  const facts: PitchFact[] = [
    { category_key: 'roofer', channel: 'email', hook: 'down', status: 'replied', opens: 2 },
    { category_key: 'roofer', channel: 'phone', hook: 'none', status: 'contacted', opens: 0 },
    { category_key: 'barber', channel: 'walk_in', hook: 'none', status: 'won', opens: 1 },
    { category_key: 'barber', channel: 'walk_in', hook: null, status: 'lost', opens: 0 },
  ];
  it('counts pitched, opened, replied and won per group, biggest group first', () => {
    const byTrade = tally(facts, (f) => f.category_key, (k) => k);
    expect(byTrade).toEqual([
      { key: 'barber', label: 'barber', pitched: 2, opened: 1, replied: 1, won: 1 },
      { key: 'roofer', label: 'roofer', pitched: 2, opened: 1, replied: 1, won: 0 },
    ]);
    const s = outreachStats(facts);
    expect(s.overall).toMatchObject({ pitched: 4, opened: 2, replied: 2, won: 1 });
    expect(s.byChannel.map((r) => r.label)).toEqual(['Walk in', 'Email', 'Phone']);
    expect(s.byHook.find((r) => r.key === 'unknown')?.pitched).toBe(1);
    expect(s.byHook.find((r) => r.key === 'down')?.label).toBe('Site down');
  });
  it('prints three tables and the headline', () => {
    const text = formatStats(outreachStats(facts));
    expect(text).toMatch(/^4 pitched, 2 opened \(50%\), 2 replied \(50%\), 1 won \(25%\)\./);
    expect(text).toContain('By trade');
    expect(text).toContain('By hook');
    expect(text).toMatch(/Site down\s+1\s+1\s+1\s+0/);
  });
  it('has nothing to say before the first pitch', () => {
    expect(formatStats(outreachStats([]))).toMatch(/^0 pitched/);
  });
});
