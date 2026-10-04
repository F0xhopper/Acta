import { describe, expect, it } from 'vitest';
import { previewLabel } from '../src/build/label.js';

describe('previewLabel', () => {
  it('drops the category and company suffixes, keeps area and business', () => {
    expect(previewLabel('kings-heath-barber-oslo-s-barbers-ltd', "Oslo's Barbers Ltd", 'Kings Heath', 'barber')).toBe('kings-heath-oslo-s');
    expect(previewLabel('erdington-plumber-supreme-plumbers', 'SUPREME PLUMBERS', 'Erdington', 'plumber')).toBe('erdington-supreme');
  });
  it('stays under 41 characters and is a valid DNS label', () => {
    const l = previewLabel('birmingham-coach-spacious-2br-apartment-with-balcony-netflix-youtube-amazon-tv-s', 'Spacious 2BR apartment with balcony netflix youtube amazon tv', 'Birmingham', 'coach');
    expect(l.length).toBeLessThanOrEqual(40);
    expect(l).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  });
  it('differs for two long names that truncate the same way', () => {
    const a = previewLabel('a-slug', 'Birmingham Central Plumbing and Heating Services Group One', 'Birmingham', 'plumber');
    const b = previewLabel('b-slug', 'Birmingham Central Plumbing and Heating Services Group Two', 'Birmingham', 'plumber');
    expect(a).not.toBe(b);
  });
});
