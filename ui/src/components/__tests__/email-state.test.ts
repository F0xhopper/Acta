import { describe, expect, it } from 'vitest';
import type { Reach } from '../../../../src/ui/api-types';
import { emailState } from '../reach';

const reach = (over: Partial<Reach>): Reach => ({ level: 'call', label: 'Call only', email: null, emailSource: null, emailUrl: null, emailAllowed: false, mobile: false, walkIn: false, socials: [], summary: '', checkedAt: '2026-10-09', webSearchedAt: null, ...over });

describe('emailState', () => {
  it('tells cold email, call first, none and not checked apart', () => {
    expect(emailState(reach({ email: 'a@b.co', emailAllowed: true }), 'live')).toBe('cold');
    expect(emailState(reach({ email: 'a@b.co' }), 'live')).toBe('call_first');
    expect(emailState(reach({}), 'live')).toBe('none');
    expect(emailState(reach({ checkedAt: null }), 'live')).toBe('unchecked');
    expect(emailState(reach({ checkedAt: null }), 'none')).toBe('none');
  });
});
