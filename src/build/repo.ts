import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, ROOT } from '../config.js';
import { git, must, run } from './exec.js';

export const STARTER_DIR = join(ROOT, 'starter');
export const sitesDir = () => { const d = join(ROOT, 'sites'); mkdirSync(d, { recursive: true }); return d; };
export const siteDir = (slug: string) => join(sitesDir(), slug);
export const repoName = (slug: string) => `site-${slug}`.slice(0, 100);

const SKIP = new Set(['node_modules', '.next', '.git', 'out', 'test-results', 'playwright-report']);

/** Fresh copy of the starter into sites/<slug>. Refuses to overwrite a repo that already has commits unless force. */
export function copyStarter(slug: string, force = false): string {
  const dir = siteDir(slug);
  if (existsSync(join(dir, '.git')) && !force) return dir;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  if (!existsSync(join(STARTER_DIR, 'package.json'))) throw new Error(`Starter not found at ${STARTER_DIR}`);
  cpSync(STARTER_DIR, dir, { recursive: true, filter: (src) => !SKIP.has(src.split('/').pop() ?? '') || src === STARTER_DIR });
  for (const d of ['acta/research', 'acta/qa', 'public/brand/photos']) mkdirSync(join(dir, d), { recursive: true });
  return dir;
}

export async function installDeps(dir: string) {
  await must('pnpm', ['install', '--prefer-offline'], { cwd: dir, timeoutMs: 10 * 60_000 });
}

export async function ensureGit(dir: string): Promise<void> {
  if (!existsSync(join(dir, '.git'))) {
    await git(dir, 'init', '-q', '-b', 'main');
    await git(dir, 'config', 'user.name', 'Acta');
    await git(dir, 'config', 'user.email', 'acta@users.noreply.github.com');
  }
}

export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, 'add', '-A');
  const status = await run('git', ['status', '--porcelain'], { cwd: dir });
  if (!status.stdout.trim()) return null;
  await git(dir, 'commit', '-q', '-m', message);
  return (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();
}

export const headSha = async (dir: string) => (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();

/** Create the private GitHub repo from the local directory and push main. Idempotent. */
export async function createRemote(dir: string, slug: string, description: string): Promise<string> {
  const owner = env('GITHUB_OWNER', 'F0xhopper');
  const name = repoName(slug);
  const full = `${owner}/${name}`;
  const exists = await run('gh', ['repo', 'view', full, '--json', 'url', '-q', '.url'], { cwd: dir });
  if (exists.code === 0 && exists.stdout.trim()) {
    const remotes = await run('git', ['remote'], { cwd: dir });
    if (!remotes.stdout.includes('origin')) await git(dir, 'remote', 'add', 'origin', `https://github.com/${full}.git`);
    return exists.stdout.trim();
  }
  await must('gh', ['repo', 'create', full, '--private', '--source', '.', '--push', '--description', description.slice(0, 350)], { cwd: dir, timeoutMs: 120_000 });
  await must('gh', ['repo', 'edit', full, '--add-topic', 'acta-preview', '--enable-issues=false', '--enable-wiki=false'], { cwd: dir });
  return `https://github.com/${full}`;
}

export async function pushMain(dir: string): Promise<void> {
  await must('git', ['push', '-u', 'origin', 'main'], { cwd: dir, timeoutMs: 120_000 });
  const remote = await must('git', ['ls-remote', '--heads', 'origin', 'main'], { cwd: dir });
  const local = await headSha(dir);
  if (!remote.stdout.includes(local)) throw new Error('push did not land: remote main differs from local HEAD');
}

export function writeFile(dir: string, rel: string, content: string) {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  return p;
}
