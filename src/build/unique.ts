import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { DATA_DIR } from '../config.js';

/** 32x32 mean-threshold perceptual hash as a hex string. Cheap, and enough to say "this is the same layout". */
export async function phash(file: string): Promise<string> {
  const buf = await sharp(file).resize(32, 32, { fit: 'fill' }).grayscale().raw().toBuffer();
  const mean = buf.reduce((a, b) => a + b, 0) / buf.length;
  let hex = '';
  for (let i = 0; i < buf.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) nibble = (nibble << 1) | (buf[i + j] > mean ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function similarity(a: string, b: string): number {
  if (a.length !== b.length || !a.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    same += 4 - ((x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1));
  }
  return same / (a.length * 4);
}

export interface Hashes { hero: string; page: string }

export function loadOtherHashes(slug: string): Record<string, Hashes> {
  const root = join(DATA_DIR, 'builds');
  if (!existsSync(root)) return {};
  const out: Record<string, Hashes> = {};
  for (const d of readdirSync(root)) {
    if (d === slug) continue;
    const f = join(root, d, 'hashes.json');
    if (existsSync(f)) { try { out[d] = JSON.parse(readFileSync(f, 'utf8')); } catch { /* ignore */ } }
  }
  return out;
}

export const UNIQUE_THRESHOLD = 0.92;

/** Compare this site's hero and page against every other site built. Saves this site's hashes. */
export async function checkUniqueness(slug: string, heroPng: string, pagePng: string): Promise<{ unique: boolean; nearest: { slug: string; hero: number; page: number } | null; hashes: Hashes }> {
  const hashes: Hashes = { hero: await phash(heroPng), page: await phash(pagePng) };
  writeFileSync(join(DATA_DIR, 'builds', slug, 'hashes.json'), JSON.stringify(hashes));
  let nearest: { slug: string; hero: number; page: number } | null = null;
  for (const [other, h] of Object.entries(loadOtherHashes(slug))) {
    const s = { slug: other, hero: similarity(hashes.hero, h.hero), page: similarity(hashes.page, h.page) };
    if (!nearest || Math.max(s.hero, s.page) > Math.max(nearest.hero, nearest.page)) nearest = s;
  }
  const unique = !nearest || (nearest.hero < UNIQUE_THRESHOLD && nearest.page < UNIQUE_THRESHOLD);
  return { unique, nearest, hashes };
}
