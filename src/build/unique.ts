/**
 * Is this site its own design, or a sibling of one already built? Compares design signatures (heading family,
 * ground and primary, hero composition, body family) rather than screenshots: a different photo makes any two
 * screenshots differ, while the same type on the same ground with the same hero reads as the same site.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.js';
import { listBuilds } from './queries.js';
import { readSignature, sameness, SAMENESS_LIMIT, type Signature } from './signature.js';

export interface Nearest { slug: string; name: string; score: number; reasons: string[] }
export interface UniquenessResult { unique: boolean; nearest: Nearest | null; signature: Signature }

const BUILT = ['built', 'gated', 'pushed', 'deployed', 'preview_ready', 'approved', 'live'];

/** Compare this site's signature against every other site built. Saves this site's signature beside its build log. */
export function checkUniqueness(slug: string, repoDir: string): UniquenessResult {
  const signature = readSignature(repoDir);
  const dir = join(DATA_DIR, 'builds', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'signature.json'), JSON.stringify(signature, null, 2));
  let nearest: Nearest | null = null;
  for (const b of listBuilds()) {
    if (b.slug === slug || !b.repo_dir || !existsSync(b.repo_dir) || !BUILT.includes(b.state)) continue;
    const s = sameness(signature, readSignature(b.repo_dir));
    if (!nearest || s.score > nearest.score) nearest = { slug: b.slug, name: b.name, score: s.score, reasons: s.reasons };
  }
  return { unique: !nearest || nearest.score < SAMENESS_LIMIT, nearest, signature };
}
