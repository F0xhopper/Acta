import { describe, expect, it } from 'vitest';
import { loadSiteTypes, requiredFixedRoutes, resolveSiteType } from '../src/build/site-type.js';
import { loadCategories } from '../src/config.js';

describe('site types', () => {
  it('every configured category maps to exactly one type', () => {
    const types = loadSiteTypes().types;
    for (const c of loadCategories()) {
      const owners = Object.entries(types).filter(([, t]) => t.categories.includes(c.key)).map(([n]) => n);
      expect(owners.length, `${c.key} -> ${owners.join(',')}`).toBeLessThanOrEqual(1);
    }
  });
  it('a barbershop gets a gallery and a map; a trade gets a gallery only with photos', () => {
    const barber = resolveSiteType('barber', { photos: 2, categoryLabel: 'Barber', paletteWord: 'black', mood: 'bold' });
    expect(barber.name).toBe('visual_craft');
    expect(requiredFixedRoutes(barber)).toContain('/gallery');
    expect(barber.features).toContain('map');
    expect(barber.pinterest[0]).toBe('barber website design bold');
    expect(requiredFixedRoutes(resolveSiteType('plumber', { photos: 2, categoryLabel: 'Plumber', paletteWord: 'blue', mood: 'clean' }))).not.toContain('/gallery');
    expect(requiredFixedRoutes(resolveSiteType('plumber', { photos: 6, categoryLabel: 'Plumber', paletteWord: 'blue', mood: 'clean' }))).toContain('/gallery');
  });
  it('unknown categories fall back to the default type', () => {
    expect(resolveSiteType('unicorn', { photos: 0, categoryLabel: 'X', paletteWord: '', mood: '' }).name).toBe('trusted_trade');
  });
});
