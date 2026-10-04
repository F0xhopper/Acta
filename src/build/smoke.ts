/**
 * deploy-smoke: prove the Vercel path with a throwaway site, then remove it. The test for the deploy step.
 */
import { existsSync, rmSync } from 'node:fs';
import { deployAvailable, deploySite, teardownDeploy } from './deploy.js';
import { commitAll, copyStarter, ensureGit, installDeps, siteDir } from './repo.js';
import { fetchWithTimeout } from '../util/http.js';

export async function deploySmoke(opts: { keep?: boolean; log?: (m: string) => void } = {}): Promise<{ ok: boolean; url: string | null; notes: string[] }> {
  const say = opts.log ?? ((m: string) => console.log(`  ${m}`));
  const notes: string[] = [];
  const avail = await deployAvailable();
  if (!avail.ok) return { ok: false, url: null, notes: [avail.detail] };
  const slug = '_smoke';
  const dir = copyStarter(slug, true);
  await installDeps(dir);
  await ensureGit(dir);
  await commitAll(dir, 'chore: smoke site');
  say(`starter copied to ${dir}`);
  const label = 'smoke';
  let ok = false;
  let url: string | null = null;
  try {
    const d = await deploySite(dir, slug, { log: say, label });
    notes.push(...d.warnings);
    url = d.previewUrl;
    if (url) {
      const res = await fetchWithTimeout(url, { timeoutMs: 20_000 });
      const robots = res.headers.get('x-robots-tag') ?? '';
      const body = await res.text();
      ok = res.status === 200 && /noindex/i.test(robots) && /Example Plumbing/.test(body);
      notes.push(`GET ${url}: ${res.status}, X-Robots-Tag "${robots}", placeholder content ${/Example Plumbing/.test(body) ? 'present' : 'missing'}`);
    }
  } catch (e) {
    notes.push(`deploy failed: ${(e as Error).message}`);
  } finally {
    if (!opts.keep) {
      notes.push(...await teardownDeploy(dir, label));
      if (existsSync(siteDir(slug))) rmSync(siteDir(slug), { recursive: true, force: true });
    } else notes.push(`kept project site-${label} and ${dir}`);
  }
  return { ok, url, notes };
}
