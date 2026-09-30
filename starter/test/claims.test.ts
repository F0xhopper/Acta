import { describe, expect, it } from 'vitest';
import { unbackedClaims } from '@/kit/claims';

describe('claims', () => {
  it('flags regulated phrases without evidence and accepts evidenced ones', () => {
    const text = 'We are Gas Safe registered, fully insured, and award-winning with over 20 years experience.';
    expect(unbackedClaims(text, [])).toEqual(expect.arrayContaining(['Gas Safe', 'fully insured', 'award-winning', '20 years experience']));
    expect(unbackedClaims(text, ['Gas Safe registered (No. 512345)', 'Fully insured', 'Award-winning service 2024', 'Over 20 years experience'])).toEqual([]);
  });
  it('ignores ordinary text', () => { expect(unbackedClaims('Friendly local plumbers in Erdington.', [])).toEqual([]); });
});
