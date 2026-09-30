import { describe, expect, it } from 'vitest';
import { STEPS, STEP_TARGET, stepsFrom, canApprove, canReject } from '../src/build/state.js';
import { phash, similarity } from '../src/build/unique.js';
import sharp from 'sharp';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('build state machine', () => {
  it('runs every step from picked', () => { expect(stepsFrom('picked', null)).toEqual([...STEPS]); });
  it('resumes after the last reached state', () => {
    expect(stepsFrom('repo_ready', null)).toEqual(['research', 'agent', 'gate', 'push', 'deploy', 'evidence']);
    expect(stepsFrom('deployed', null)).toEqual(['evidence']);
    expect(stepsFrom('preview_ready', null)).toEqual([]);
  });
  it('resumes a failure at the failed step', () => {
    expect(stepsFrom('failed', 'gate')).toEqual(['gate', 'push', 'deploy', 'evidence']);
    expect(stepsFrom('failed', null)).toEqual([...STEPS]);
  });
  it('revising re-runs the agent onward', () => { expect(stepsFrom('revising', null)).toEqual(['agent', 'gate', 'push', 'deploy', 'evidence']); });
  it('every step has a target state after it', () => { for (const s of STEPS) expect(STEP_TARGET[s]).toBeTruthy(); });
  it('review rules', () => { expect(canApprove('preview_ready')).toBe(true); expect(canApprove('built')).toBe(false); expect(canReject('approved')).toBe(true); });
});

describe('perceptual hash', () => {
  const img = async (name: string, draw: string) => {
    const p = join(tmpdir(), `acta-${name}-${Date.now()}.png`);
    await sharp(Buffer.from(`<svg width="390" height="844">${draw}</svg>`)).png().toFile(p);
    return p;
  };
  it('identical layouts hash the same, different layouts differ', async () => {
    const a = await img('a', '<rect width="390" height="844" fill="#fff"/><rect x="20" y="100" width="350" height="300" fill="#123"/><rect x="20" y="500" width="350" height="60" fill="#c00"/>');
    const b = await img('b', '<rect width="390" height="844" fill="#fff"/><rect x="20" y="100" width="350" height="300" fill="#1a2b3c"/><rect x="20" y="500" width="350" height="60" fill="#d11"/>');
    const c = await img('c', '<rect width="390" height="844" fill="#000"/><circle cx="195" cy="300" r="120" fill="#fff"/><rect x="0" y="700" width="390" height="144" fill="#fff"/>');
    const [ha, hb, hc] = await Promise.all([phash(a), phash(b), phash(c)]);
    expect(similarity(ha, hb)).toBeGreaterThan(0.95);
    expect(similarity(ha, hc)).toBeLessThan(0.8);
    expect(similarity(ha, ha)).toBe(1);
  });
});
