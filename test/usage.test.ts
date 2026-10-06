import { describe, expect, it } from 'vitest';
import { overLimit, parseUsage } from '../src/build/usage.js';

const sample = `You are currently using your subscription to power your Claude Code usage

Current session: 5% used · resets Oct 7 at 2:09am (Europe/London)
Current week (all models): 53% used · resets Oct 8 at 12:59am (Europe/London)
Current week (Fable): 100% used · resets Oct 8 at 12:59am (Europe/London)`;

describe('usage guard', () => {
  it('reads session and all-models week, not the per-model line', () => {
    expect(parseUsage(sample)).toEqual({ session: 5, week: 53 });
  });
  it('stops on whichever limit reaches the threshold first', () => {
    expect(overLimit({ session: 5, week: 53 }, 70)).toBeNull();
    expect(overLimit({ session: 71, week: 53 }, 70)).toBe('session at 71%');
    expect(overLimit({ session: 5, week: 70 }, 70)).toBe('week at 70%');
  });
  it('returns nulls for text it does not recognise', () => {
    expect(parseUsage('something else')).toEqual({ session: null, week: null });
  });
});
