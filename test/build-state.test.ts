import { describe, expect, it } from 'vitest';
import { STEPS, STEP_TARGET, stepsFrom, canApprove, canReject } from '../src/build/state.js';

describe('build state machine', () => {
  it('runs every step from picked, and from the call checkpoint', () => {
    expect(stepsFrom('picked', null)).toEqual([...STEPS]);
    expect(stepsFrom('awaiting_call', null)).toEqual([...STEPS]);
  });
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

describe('usage pause', () => {
  it('resumes at the step the agent was stopped in, like a failure', () => {
    expect(stepsFrom('awaiting_usage', 'agent')).toEqual(['agent', 'gate', 'push', 'deploy', 'evidence']);
    expect(stepsFrom('awaiting_usage', 'gate')).toEqual(['gate', 'push', 'deploy', 'evidence']);
  });
});
