/**
 * Memory of earlier Acta sites, given to each new build so it doesn't repeat them: each site's signature (type, ground,
 * hero composition, direction, the one move) read from the files it was built from, plus its mobile hero screenshot
 * copied into the new repo's research folder, and a "do not reuse" list drawn from the most recent sites.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listBuilds } from './queries.js';
import { writeFile } from './repo.js';
import { describeSignature, readSignature, type Signature } from './signature.js';

export interface PreviousSite { name: string; slug: string; signature: Signature; shot: string | null; live: string | null }

const BUILT = ['built', 'gated', 'pushed', 'deployed', 'preview_ready', 'approved', 'live'];
/** How many of the most recent sites set the "do not reuse" list. */
export const RECENT = 5;

/** Pure: the markdown the designer reads. Most recent first. */
export function previousSitesMd(sites: PreviousSite[]): string {
  const lines = ['# Previous Acta sites', '', 'Every site below already exists. This one must not look like any of them: not the same organising idea, not the same hero composition, not the same type and ground. The pipeline checks the signature after the build and sends it back when it matches.', ''];
  if (!sites.length) { lines.push('None yet: this is the first.', ''); return lines.join('\n'); }
  const recent = sites.slice(0, RECENT);
  const families = [...new Set(recent.map((s) => s.signature.headingFont).filter(Boolean))] as string[];
  const bodies = [...new Set(recent.map((s) => s.signature.bodyFont).filter(Boolean))] as string[];
  const heroes = [...new Set(recent.map((s) => s.signature.hero).filter(Boolean))] as string[];
  const grounds = [...new Set(recent.map((s) => (s.signature.mode && s.signature.primary ? describeSignature({ ...s.signature, headingFont: null, bodyFont: null, hero: null }) : null)).filter(Boolean))] as string[];
  lines.push('## Do not reuse', '', `From the last ${recent.length} site${recent.length === 1 ? '' : 's'}:`,
    `- Heading families: ${families.join(', ') || 'none recorded'}`,
    `- Body families: ${bodies.join(', ') || 'none recorded'}`,
    `- Hero compositions: ${heroes.join(', ') || 'none recorded'}`,
    `- Ground and primary: ${grounds.join('; ') || 'none recorded'}`,
    '', 'A heading family used by a recent site is out. A hero composition used by a recent site needs a different ground and primary. Say in the brief\'s Signature block how this site differs from each.', '');
  for (const s of sites) {
    const g = s.signature;
    lines.push(`## ${s.name}`, '',
      `- Signature: ${describeSignature(g)}`,
      ...(g.direction ? [`- Direction: ${g.direction}`] : []),
      ...(g.concept ? [`- Concept: ${g.concept}`] : []),
      ...(g.move ? [`- One move: ${g.move}`] : []),
      ...(s.shot ? [`- Mobile hero: \`${s.shot}\``] : []),
      ...(s.live ? [`- Live: ${s.live}`] : []), '');
  }
  return lines.join('\n');
}

export function writePreviousSites(repoDir: string, slug: string): number {
  const rows = listBuilds().filter((b) => b.slug !== slug && b.repo_dir && existsSync(b.repo_dir) && BUILT.includes(b.state));
  const outDir = join(repoDir, 'acta', 'research', 'previous');
  mkdirSync(outDir, { recursive: true });
  const sites: PreviousSite[] = rows.map((b) => {
    const dir = b.repo_dir!;
    const hero = join(dir, 'acta', 'qa', 'hero-mobile.png');
    let shot: string | null = null;
    if (existsSync(hero)) { const dest = join(outDir, `${b.slug}-hero.png`); copyFileSync(hero, dest); shot = `acta/research/previous/${b.slug}-hero.png`; }
    return { name: b.name, slug: b.slug, signature: readSignature(dir), shot, live: b.preview_url ?? null };
  });
  writeFile(repoDir, 'acta/research/previous-acta-sites.md', previousSitesMd(sites));
  return sites.length;
}
