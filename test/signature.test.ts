import { describe, expect, it } from 'vitest';
import { describeSignature, parseSignature, sameness, SAMENESS_LIMIT } from '../src/build/signature.js';
import { previousSitesMd } from '../src/build/previous.js';

const theme = (heading: string, body: string, primary: string, background: string) => `
export const theme = {
  colors: {
    primary: '${primary}', // the brand
    onPrimary: '#ffffff',
    background: '${background}',
    text: '#111111',
  },
  fonts: {
    /** Family names. */
    heading: '${heading}',
    body: '${body}',
  },
} as const;`;

const brief = `# Brief

## Signature
- Direction: Warm, generous, in order
- Hero composition: split-left-photo
- One move: the meal as the structure of the site
`;

describe('design signature', () => {
  it('reads type, ground, hue and the Signature block', () => {
    const s = parseSignature(theme('Fraunces', 'Figtree', '#A33A1A', '#F7EEDF'), brief, '## Chosen\n\nConcept 1: The Meal, In Order.');
    expect(s.headingFont).toBe('Fraunces');
    expect(s.bodyFont).toBe('Figtree');
    expect(s.mode).toBe('light');
    expect(s.hue).toBe(0);
    expect(s.hero).toBe('split-left-photo');
    expect(s.direction).toBe('Warm, generous, in order');
    expect(s.move).toMatch(/the meal/);
    expect(s.concept).toMatch(/^Concept 1/);
  });
  it('reads a direction written as a heading in older briefs, and treats a neutral primary as no hue', () => {
    const s = parseSignature(theme('Archivo', 'Public Sans', '#252160', '#111111'), '## 3. Direction\n\n**Square, navy, sampled.**\n', '');
    expect(s.direction).toBe('Square, navy, sampled.');
    expect(s.mode).toBe('dark');
    expect(s.hero).toBeNull();
    expect(parseSignature(theme('Inter', 'Inter', '#1f2937', '#ffffff'), '', '').hue).toBeNull();
  });
  it('scores sameness by what makes sites look like siblings', () => {
    const a = parseSignature(theme('Archivo', 'Figtree', '#111111', '#f7f6f2'), '- Hero composition: photo-top-text-below', '');
    const same = parseSignature(theme('Archivo', 'Public Sans', '#252160', '#ffffff'), '- Hero composition: photo-top-text-below', '');
    const different = parseSignature(theme('Fraunces', 'Figtree', '#A33A1A', '#F7EEDF'), '- Hero composition: split-left-photo', '');
    expect(sameness(a, same).score).toBeGreaterThanOrEqual(SAMENESS_LIMIT);
    expect(sameness(a, same).reasons.join()).toMatch(/heading family \(Archivo\)/);
    expect(sameness(a, different).score).toBeLessThan(SAMENESS_LIMIT);
    expect(describeSignature(different)).toBe('Fraunces over Figtree, light ground, red primary, split-left-photo hero');
  });
  it('writes the previous-sites memory with a do-not-reuse list', () => {
    const sig = parseSignature(theme('Barlow Condensed', 'Barlow', '#F7D117', '#111111'), '- Direction: The plate\n- Hero composition: photo-top-text-below\n- One move: the name hung as a number plate', '## Chosen\n\nConcept 1: The Plate.');
    const md = previousSitesMd([{ name: "Oslo's Barbers", slug: 'oslo', signature: sig, shot: 'acta/research/previous/oslo-hero.png', live: null }]);
    expect(md).toContain('Heading families: Barlow Condensed');
    expect(md).toContain('Hero compositions: photo-top-text-below');
    expect(md).toContain('dark ground, yellow primary');
    expect(md).toContain('- One move: the name hung as a number plate');
    expect(md).toContain('`acta/research/previous/oslo-hero.png`');
    expect(previousSitesMd([])).toContain('None yet');
  });
});
