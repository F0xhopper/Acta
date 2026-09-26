import { describe, expect, it } from 'vitest';
import { displayUkPhone, findUkPhones, normaliseUkPhone } from '../src/util/phone.js';

describe('phone', () => {
  it('normalises common UK formats', () => {
    expect(normaliseUkPhone('0121 123 4567')).toBe('+441211234567');
    expect(normaliseUkPhone('+44 121 123 4567')).toBe('+441211234567');
    expect(normaliseUkPhone('(0121) 123-4567')).toBe('+441211234567');
    expect(normaliseUkPhone('07700 900123')).toBe('+447700900123');
    expect(normaliseUkPhone('0044 7700 900123')).toBe('+447700900123');
  });
  it('rejects junk', () => {
    expect(normaliseUkPhone('12345')).toBeNull();
    expect(normaliseUkPhone('')).toBeNull();
    expect(normaliseUkPhone(null)).toBeNull();
  });
  it('finds phones in text', () => {
    expect(findUkPhones('Call us on 0121 123 4567 or 07700 900123 today')).toEqual(['+441211234567', '+447700900123']);
  });
  it('formats for display', () => {
    expect(displayUkPhone('+441211234567')).toBe('0121 123 4567');
    expect(displayUkPhone('+447700900123')).toBe('07700 900123');
  });
});
