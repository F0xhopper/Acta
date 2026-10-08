import { describe, expect, it } from 'vitest';
import { columnFor, movesFor, nextSunday22 } from '../src/ui/summary.js';
import { buildRail, nextActionFor, notesTimeline } from '../src/ui/mappers.js';
import { agentPick, parseConcepts } from '../src/build/checkpoints.js';
import { cropBox } from '../src/ui/feedback.js';
import { stepsFrom } from '../src/build/state.js';
import { createApp } from '../src/ui/server.js';

describe('board', () => {
  it('puts each status in its column', () => {
    expect(columnFor('shortlisted', 'picked')).toBe('picked');
    expect(columnFor('building', 'awaiting_photos')).toBe('building');
    expect(columnFor('preview_ready', 'preview_ready')).toBe('preview');
    expect(columnFor('preview_ready', 'approved')).toBe('ready');
    expect(columnFor('followup_2', 'approved')).toBe('sent');
    expect(columnFor('do_not_contact', null)).toBe('closed');
  });
  it('only allows approval from a finished preview, and nothing out of closed', () => {
    expect(movesFor('preview', 'preview_ready')).toContain('ready');
    expect(movesFor('preview', 'failed')).not.toContain('ready');
    expect(movesFor('building', 'gated')).toEqual(['closed']);
    expect(movesFor('closed', null)).toEqual([]);
  });
  it('finds the next Sunday 22:00', () => {
    const t = nextSunday22(new Date(2026, 9, 7, 12, 0)); // Wednesday 7 October 2026
    expect([t.getDay(), t.getHours(), t.getDate()]).toEqual([0, 22, 11]);
    expect(nextSunday22(new Date(2026, 9, 11, 23, 0)).getDate()).toBe(18);
  });
});

describe('build rail and checkpoints', () => {
  const on = { curated: false, chosen: false, photosOn: true, conceptOn: true };
  it('shows the photo checkpoint waiting', () => {
    const r = buildRail('awaiting_photos', null, false, on);
    expect(r.find((s) => s.key === 'photos')?.status).toBe('waiting');
    expect(r.find((s) => s.key === 'repo')?.status).toBe('done');
    expect(r.find((s) => s.key === 'research')?.status).toBe('todo');
  });
  it('marks the current step while running', () => {
    const r = buildRail('researched', null, true, { ...on, curated: true });
    expect(r.find((s) => s.status === 'current')?.key).toBe('concepts');
  });
  it('marks skipped checkpoints on an old build', () => {
    const r = buildRail('preview_ready', null, false, on);
    expect(r.find((s) => s.key === 'concepts')?.status).toBe('skipped');
    expect(r.every((s) => s.status === 'done' || s.status === 'skipped')).toBe(true);
  });
  it('resumes after each checkpoint at the right step', () => {
    expect(stepsFrom('awaiting_photos', null)[0]).toBe('research');
    expect(stepsFrom('awaiting_concept', null)[0]).toBe('agent');
  });
  it('picks the next action', () => {
    expect(nextActionFor('building', { state: 'awaiting_concept', failedStep: null, activeJobId: null }, false)?.tab).toBe('concepts');
    expect(nextActionFor('preview_ready', { state: 'approved', failedStep: null, activeJobId: null }, false)?.kind).toBe('send');
    expect(nextActionFor('preview_ready', { state: 'approved', failedStep: null, activeJobId: null }, true)).toBeNull();
    expect(nextActionFor('new', null, false)?.kind).toBe('build');
  });
  it('reads dated status notes', () => {
    expect(notesTimeline('2026-10-06: approved for outreach\nnot dated')[0].text).toBe('Approved for outreach');
  });
});

describe('concepts', () => {
  const md = `# Concepts

## Concept 1: The window sign
- **Idea**: the site reads like the shop's signage. Colours #111111 and #F2C230.

## Concept 2: Ledger
Idea: a barber's appointment book.

## Concept 3: Neon
Idea: night-time Stratford Road.

## Scores
| Concept 1 | total 21 |
| Concept 2 | total 17 |

## Agent's pick
Concept 1, because it is the most distinct.
`;
  it('parses names, ideas, palette and scores', () => {
    const c = parseConcepts(md);
    expect(c.map((x) => x.name)).toEqual(['The window sign', 'Ledger', 'Neon']);
    expect(c[0].palette).toEqual(['#111111', '#f2c230']);
    expect(c[0].score).toBe(21);
    expect(c[1].idea).toContain("appointment book");
  });
  it("finds the agent's pick", () => { expect(agentPick(md)).toBe(1); });
});

describe('review crops', () => {
  it('keeps the crop inside the screenshot', () => {
    const b = cropBox('mobile', 780, 4000, 0.99, 0.001);
    expect(b.left + b.width).toBeLessThanOrEqual(780);
    expect(b.top).toBe(0);
    expect(cropBox('desktop', 500, 300, 0.5, 0.5).width).toBe(500);
  });
});

describe('server security', () => {
  it('refuses a foreign host and a foreign origin', async () => {
    const app = createApp();
    expect((await app.request('/api/meta', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await app.request('/api/search', { method: 'POST', headers: { host: '127.0.0.1:4321', origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
  });
});
