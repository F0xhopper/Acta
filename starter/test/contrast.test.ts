import { describe, expect, it } from 'vitest';
import { contrastRatio, passesAA } from '@/kit/contrast';
import { theme } from '@/theme';

describe('contrast', () => {
  it('black on white is 21:1, white on white is 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#fff')).toBeCloseTo(1, 5);
  });
  it('AA threshold', () => {
    expect(passesAA('#767676', '#ffffff')).toBe(true);
    expect(passesAA('#8a8a8a', '#ffffff')).toBe(false);
  });
  it('the placeholder theme passes its own gate pairs', () => {
    const c = theme.colors;
    for (const [fg, bg] of [[c.text, c.background], [c.muted, c.background], [c.text, c.surface], [c.onPrimary, c.primary], [c.primary, c.background]]) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
