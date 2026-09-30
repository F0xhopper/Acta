import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GateReportSchema, SITE_PATHS, type GateReport } from './contracts.js';
import { run } from './exec.js';
import { headSha } from './repo.js';

export interface GateRun { report: GateReport | null; passed: boolean; failing: string[]; output: string; error: string | null }

/** Run the site's own gate script and read back its report. The pipeline never trusts a report it didn't produce. */
export async function runGates(dir: string, opts: { fast?: boolean; log?: (m: string) => void } = {}): Promise<GateRun> {
  const say = opts.log ?? (() => undefined);
  const script = opts.fast ? 'gate:fast' : 'gate';
  say(`pnpm ${script}`);
  const r = await run('pnpm', ['-s', script], { cwd: dir, env: { ACTA_PREVIEW: '1' }, timeoutMs: 20 * 60_000, onLine: (l) => { if (/gate|✓|✗|fail|pass/i.test(l)) say(l.trim().slice(0, 200)); } });
  const file = join(dir, SITE_PATHS.gate);
  if (!existsSync(file)) return { report: null, passed: false, failing: ['gate script produced no report'], output: r.stdout + r.stderr, error: (r.stderr || r.stdout).trim().split('\n').slice(-8).join(' | ') };
  let report: GateReport;
  try {
    report = GateReportSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    return { report: null, passed: false, failing: ['gate report invalid'], output: r.stdout + r.stderr, error: (e as Error).message.slice(0, 500) };
  }
  const sha = await headSha(dir).catch(() => 'nogit');
  const failing = report.gates.filter((g) => !g.pass).map((g) => `${g.name}${g.value !== undefined && g.value !== null ? ` (${g.value}${g.threshold ? `, needs ${g.threshold}` : ''})` : ''}${g.details?.length ? `: ${g.details.slice(0, 3).join('; ')}` : ''}`);
  if (report.head_sha !== 'nogit' && sha !== 'nogit' && report.head_sha !== sha) failing.push(`report is for ${report.head_sha.slice(0, 7)}, HEAD is ${sha.slice(0, 7)}`);
  return { report, passed: report.pass && failing.length === 0, failing, output: r.stdout + r.stderr, error: null };
}

export async function takeShots(dir: string, log?: (m: string) => void): Promise<{ hero: string; mobile: string } | null> {
  const r = await run('pnpm', ['-s', 'shots'], { cwd: dir, env: { ACTA_PREVIEW: '1' }, timeoutMs: 5 * 60_000 });
  const hero = join(dir, SITE_PATHS.qa, 'hero-mobile.png');
  const mobile = join(dir, SITE_PATHS.qa, 'mobile.png');
  if (r.code !== 0 || !existsSync(hero) || !existsSync(mobile)) { log?.(`shots failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`); return null; }
  return { hero, mobile };
}
