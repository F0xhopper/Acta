import { describe, expect, it } from 'vitest';
import { citiesFor, curatedFor, galleryTargets, inspirationMd, loadInspiration } from '../src/build/inspiration.js';

const cfg = loadInspiration();

describe('inspiration', () => {
  it('fills gallery addresses for the trade and kind of site', () => {
    const t = galleryTargets(cfg, 'visual_craft', 'barber');
    expect(t.find((g) => g.name === 'One Page Love')?.url).toBe('https://onepagelove.com/?s=barber');
    expect(t.find((g) => g.name === 'Awwwards by industry')?.url).toContain('/health-beauty/');
    expect(galleryTargets(cfg, 'unknown_type', 'plumber').find((g) => g.name === 'Awwwards by industry')?.url).toContain('/business-corporate/');
  });
  it('craft leads the mix and template catalogues are out', () => {
    expect(cfg.mix.craft).toBeGreaterThan(cfg.mix.structure);
    expect(cfg.galleries.some((g) => /squarespace|framer|wix/i.test(g.name))).toBe(false);
  });
  it('gives every site type a curated list plus a rotating pair from any, without duplicates', () => {
    for (const type of ['visual_craft', 'hospitality', 'trusted_trade', 'professional', 'fitness']) {
      const list = curatedFor(cfg, type, 'seed-a');
      expect(list.length).toBeGreaterThanOrEqual(5);
      expect(list.length).toBeLessThanOrEqual(cfg.curated.max_per_build);
      const hosts = list.map((s) => new URL(s.url).host);
      expect(new Set(hosts).size).toBe(hosts.length);
      for (const s of list) expect(s.note.length).toBeGreaterThan(20);
    }
    const a = curatedFor(cfg, 'visual_craft', 'oslo'), b = curatedFor(cfg, 'visual_craft', 'another-seed-entirely');
    expect(a.map((s) => s.url).join()).not.toBe(b.map((s) => s.url).join());
  });
  it('rotates cities per build and never uses the home city', () => {
    const a = citiesFor(cfg, 'oslo', 'London'); const b = citiesFor(cfg, 'phit', 'London');
    expect(a).toHaveLength(cfg.real_sites.per_build);
    expect(a).not.toContain('London');
    expect(a.join()).not.toBe(b.join());
  });
  it('writes a note that puts craft first and lists every screenshot', () => {
    const md = inspirationMd(cfg, 'barber', {
      curated: [{ name: 'Ruffians', url: 'https://www.ruffians.co.uk', note: 'Barbers. Big photography.', mobile: 'craft/ruffians-mobile.png', desktop: 'craft/ruffians-desktop.png', scroll: null }],
      realSites: [{ name: 'Skeleton Barbers', city: 'Bristol', url: 'https://x', rating: 4.9, reviews: 707, mobile: 'real-sites/s-mobile.png', desktop: null }],
      galleries: [{ name: 'One Page Love', kind: 'structure', url: 'https://onepagelove.com/?s=barber', shot: 'galleries/one-page-love.png' }],
      notes: [],
    });
    expect(md).toContain('about 5 craft and 3 structure');
    expect(md.indexOf('Craft sets the bar')).toBeLessThan(md.indexOf('Structure is the floor'));
    expect(md).toContain('acta/research/craft/ruffians-desktop.png');
    expect(md).toContain('acta/research/real-sites/s-mobile.png');
    expect(md).toContain('pnpm refs');
    expect(md).toMatch(/Never copy text, images/);
  });
});
