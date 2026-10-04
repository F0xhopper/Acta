import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT } from './config.js';
import { run } from './build/exec.js';
import { openDb } from './db/index.js';
import { deployAvailable } from './build/deploy.js';

export interface Check { name: string; ok: boolean; detail: string; required: boolean }

export async function doctor(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, required = true) => checks.push({ name, ok, detail, required });
  const major = Number(process.versions.node.split('.')[0]);
  add('Node 22+', major >= 22, `v${process.versions.node}`);
  const env = (k: string) => Boolean(process.env[k]);
  add('Google Places key', env('GOOGLE_PLACES_API_KEY'), env('GOOGLE_PLACES_API_KEY') ? 'set' : 'GOOGLE_PLACES_API_KEY missing in .env');
  add('Companies House key', env('COMPANIES_HOUSE_API_KEY'), env('COMPANIES_HOUSE_API_KEY') ? 'set' : 'COMPANIES_HOUSE_API_KEY missing in .env');
  try { openDb(); add('Database', true, join(DATA_DIR, 'leads.db')); } catch (e) { add('Database', false, (e as Error).message); }
  const gh = await run('gh', ['auth', 'status'], { cwd: ROOT });
  add('GitHub CLI logged in', gh.code === 0, gh.code === 0 ? 'ok' : 'run: gh auth login');
  const claude = await run('which', ['claude'], { cwd: ROOT });
  add('Claude Code CLI', claude.code === 0, claude.code === 0 ? claude.stdout.trim() : 'claude not on PATH');
  const pw = await run('pnpm', ['exec', 'playwright', '--version'], { cwd: ROOT });
  add('Playwright', pw.code === 0, pw.code === 0 ? pw.stdout.trim() : 'pnpm exec playwright install chromium');
  add('Starter installed', existsSync(join(ROOT, 'starter', 'node_modules')), existsSync(join(ROOT, 'starter', 'node_modules')) ? 'starter/node_modules present' : 'cd starter && pnpm install');
  const session = join(DATA_DIR, 'builds', '_sessions', 'pinterest.json');
  const age = existsSync(session) ? Math.round((Date.now() - statSync(session).mtimeMs) / 86_400_000) : null;
  add('Pinterest session', age !== null && age < 30, age === null ? 'none saved: pnpm pipeline research --login (builds fall back without it)' : `${age} days old`, false);
  const v = await deployAvailable();
  add('Vercel', v.ok, v.ok ? `${v.detail}${process.env.PREVIEW_DOMAIN ? '' : ' (no PREVIEW_DOMAIN: previews use *.vercel.app URLs)'}` : `${v.detail}: previews stay local`, false);
  if (process.env.PREVIEW_DOMAIN) {
    const dig = await run('dig', ['+short', 'CNAME', `probe.${process.env.PREVIEW_DOMAIN}`], { cwd: ROOT });
    add('Preview wildcard DNS', dig.stdout.trim().length > 0, dig.stdout.trim() || `no CNAME for *.${process.env.PREVIEW_DOMAIN}`, false);
  }
  const lc = await run('launchctl', ['list'], { cwd: ROOT });
  const jobs = ['com.acta.week', 'com.acta.builds', 'com.acta.day'].filter((j) => lc.stdout.includes(j));
  add('Scheduled jobs', jobs.length === 3, jobs.length ? `loaded: ${jobs.join(', ')}` : 'none loaded: pnpm pipeline schedule install', false);
  return checks;
}

export const doctorOk = (checks: Check[]) => checks.filter((c) => c.required).every((c) => c.ok);

export function formatDoctor(checks: Check[]): string {
  return checks.map((c) => `${c.ok ? '✓' : c.required ? '✗' : '·'} ${c.name.padEnd(24)} ${c.detail}`).join('\n');
}
