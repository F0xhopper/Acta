import { describe, expect, it } from 'vitest';
import { AutopilotSchema, decide, nextChore, pastTime, reasonOf, type Snapshot } from '../src/loop/autopilot.js';
import { appleScript } from '../src/loop/notify.js';
import { flipFlag } from '../src/loop/automation.js';
import { defaultJobs, JOBS, plist } from '../src/loop/schedule.js';

const cfg = AutopilotSchema.parse({});
// Wednesday 7 October 2026, 12:00 local: leads (07:30) and day (09:15) are both past; week is Sunday only.
const noon = new Date(2026, 9, 7, 12, 0);
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  on: true, sweepOn: true, usageOver: null, agentBusy: false, paused: [], unreviewed: 0, buildsToday: 0, failedToday: 0, queue: [],
  choresToday: new Set(['leads', 'day']), now: noon, ...over,
});
const last = (s: Snapshot) => decide(s, cfg).at(-1)!;

describe('autopilot decisions', () => {
  it('picks when nothing is building and nothing is queued', () => {
    expect(decide(snap(), cfg)).toEqual([{ kind: 'pick' }]);
  });
  it('builds the picked queue before picking anything new', () => {
    expect(last(snap({ queue: ['a', 'b'] }))).toEqual({ kind: 'build', slug: 'a' });
  });
  it('does one agent job at a time', () => {
    expect(last(snap({ agentBusy: true, queue: ['a'] }))).toMatchObject({ kind: 'idle', reason: /running/ });
  });
  it('resumes paused builds, even when it is off, but not over the usage limit', () => {
    expect(decide(snap({ on: false, paused: ['p'] }), cfg)).toEqual([{ kind: 'resume', slug: 'p' }, { kind: 'idle', reason: expect.stringMatching(/^Off/) }]);
    expect(decide(snap({ paused: ['p'], usageOver: 'the session is at 72%' }), cfg)).toEqual([{ kind: 'idle', reason: expect.stringMatching(/usage to reset.*72%.*1 paused build/) }]);
    expect(decide(snap({ paused: ['p'], queue: ['a'] }), cfg)).toEqual([{ kind: 'resume', slug: 'p' }, { kind: 'idle', reason: expect.stringMatching(/Carrying on 1 build/) }]);
  });
  it('waits at the usage limit, the review cap, the daily cap and after repeated failures', () => {
    expect(last(snap({ usageOver: 'the week is at 70%', queue: ['a'] })).kind).toBe('idle');
    expect(last(snap({ unreviewed: 3, queue: ['a'] }))).toMatchObject({ reason: /3 previews waiting.*stops at 3/ });
    expect(last(snap({ unreviewed: 2, queue: ['a'] })).kind).toBe('build');
    expect(last(snap({ buildsToday: 3 }))).toMatchObject({ reason: /daily limit/ });
    expect(last(snap({ failedToday: 2, queue: ['a'] }))).toMatchObject({ reason: /2 builds failed today/ });
  });
  it('runs each due chore once a day, on its days, and the lead search only when the sweep is on', () => {
    const due = decide(snap({ choresToday: new Set() }), cfg).filter((a) => a.kind === 'chore');
    expect(due).toEqual([{ kind: 'chore', chore: 'leads' }, { kind: 'chore', chore: 'day' }]);
    expect(decide(snap({ choresToday: new Set(), sweepOn: false }), cfg).filter((a) => a.kind === 'chore')).toEqual([{ kind: 'chore', chore: 'day' }]);
    expect(decide(snap({ choresToday: new Set(), now: new Date(2026, 9, 7, 7, 0) }), cfg).filter((a) => a.kind === 'chore')).toEqual([]);
    const sunday = new Date(2026, 9, 11, 22, 30);
    expect(decide(snap({ choresToday: new Set(['leads']), now: sunday }), cfg).filter((a) => a.kind === 'chore')).toEqual([{ kind: 'chore', chore: 'week' }]);
    expect(decide(snap({ choresToday: new Set(), on: false }), cfg).some((a) => a.kind === 'chore')).toBe(false);
  });
  it('explains a fresh decision', () => {
    expect(reasonOf([{ kind: 'pick' }])).toMatch(/pick the best lead/);
    expect(reasonOf([{ kind: 'build', slug: 'x' }])).toMatch(/build x/);
  });
});

describe('timetable', () => {
  it('knows whether a time of day has passed', () => {
    expect(pastTime(noon, '07:30')).toBe(true);
    expect(pastTime(new Date(2026, 9, 7, 7, 29), '07:30')).toBe(false);
  });
  it('finds the next run, skipping what already ran today', () => {
    expect(nextChore(noon, cfg, new Set(['leads', 'day']))).toMatchObject({ kind: 'leads', at: new Date(2026, 9, 8, 7, 30) });
    expect(nextChore(new Date(2026, 9, 7, 6, 0), cfg, new Set())).toMatchObject({ kind: 'leads', at: new Date(2026, 9, 7, 7, 30) });
    expect(nextChore(new Date(2026, 9, 7, 8, 0), cfg, new Set(['leads']))).toMatchObject({ kind: 'day', at: new Date(2026, 9, 7, 9, 15) });
    expect(nextChore(new Date(2026, 9, 10, 12, 0), cfg, new Set(['leads']), false)).toMatchObject({ kind: 'week', at: new Date(2026, 9, 11, 22, 0) }); // Saturday, sweep off
  });
  it('has sensible defaults and rejects a bad time', () => {
    expect(cfg).toEqual({ max_builds_per_day: 3, max_unreviewed: 3, leads_at: '07:30', day_at: '09:15', week_at: '22:00' });
    expect(() => AutopilotSchema.parse({ leads_at: '7am' })).toThrow();
  });
});

describe('notifications and switches', () => {
  it('quotes the AppleScript safely', () => {
    expect(appleScript('Acta', 'Oslo\'s "Barbers"\nready')).toBe('display notification "Oslo\'s \\"Barbers\\" ready" with title "Acta" sound name "Glass"');
  });
  it('flips one automation line and leaves the rest', () => {
    const yaml = '# c\nautomation:\n  # a comment\n  sweep: true\n  auto_pick: false\n  web_email: true\n  autopilot: false\nother:\n  autopilot: false\n';
    const out = flipFlag(yaml, 'autopilot', true);
    expect(out).toContain('  autopilot: true\nother:\n  autopilot: false');
    expect(out).toContain('  sweep: true\n');
    expect(flipFlag(yaml, 'sweep', false)).toContain('  sweep: false\n  auto_pick: false');
    expect(() => flipFlag('automation:\n  sweep: true\n', 'autopilot', true)).toThrow(/autopilot/);
  });
  it('installs the always-on server with the autopilot on, the calendar jobs otherwise', () => {
    expect(defaultJobs(true)).toEqual(['ui']);
    expect(defaultJobs(false)).toEqual(['leads', 'week', 'builds', 'day']);
    const ui = plist(JOBS.find((j) => j.label === 'com.acta.ui')!);
    expect(ui).toContain('<key>KeepAlive</key><true/>');
    expect(ui).toContain('pipeline ui');
    expect(ui).not.toContain('StartCalendarInterval');
    const leads = plist(JOBS.find((j) => j.label === 'com.acta.leads')!);
    expect(leads).toContain('StartCalendarInterval');
    expect(leads).not.toContain('KeepAlive');
  });
});
