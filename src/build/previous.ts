/**
 * Memory of earlier Acta sites, given to each new build so it doesn't repeat them: each site's concept and
 * direction line from its brief, plus its mobile hero screenshot copied into the new repo's research folder.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listBuilds } from './queries.js';
import { writeFile } from './repo.js';

function firstMatch(file: string, re: RegExp): string | null {
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(re);
  return m ? m[1].replace(/\*\*/g, '').trim() : null;
}

export function writePreviousSites(repoDir: string, slug: string): number {
  const rows = listBuilds().filter((b) => b.slug !== slug && b.repo_dir && existsSync(b.repo_dir) && ['built', 'gated', 'pushed', 'deployed', 'preview_ready', 'approved', 'live'].includes(b.state));
  const outDir = join(repoDir, 'acta', 'research', 'previous');
  mkdirSync(outDir, { recursive: true });
  const lines = ['# Previous Acta sites', '', 'Every site below already exists. This one must not look like any of them: not the same organising idea, not the same hero composition, not the same palette-and-type combination.', ''];
  for (const b of rows) {
    const dir = b.repo_dir!;
    const direction = firstMatch(join(dir, 'acta', 'brief.md'), /Direction:\s*([^\n]+)/) ?? 'unknown';
    const chosen = firstMatch(join(dir, 'acta', 'concepts.md'), /## Chosen\s*\n+([^\n]+)/);
    const hero = join(dir, 'acta', 'qa', 'hero-mobile.png');
    let shot = '';
    if (existsSync(hero)) { const dest = join(outDir, `${b.slug}-hero.png`); copyFileSync(hero, dest); shot = `acta/research/previous/${b.slug}-hero.png`; }
    lines.push(`## ${b.name}`, '', `- Direction: ${direction}`, ...(chosen ? [`- Concept: ${chosen}`] : []), ...(shot ? [`- Mobile hero: \`${shot}\``] : []), ...(b.preview_url ? [`- Live: ${b.preview_url}`] : []), '');
  }
  if (!rows.length) lines.push('None yet: this is the first.');
  writeFile(repoDir, 'acta/research/previous-acta-sites.md', lines.join('\n') + '\n');
  return rows.length;
}
