import { fetchWithTimeout, sleep } from '../util/http.js';
import { run } from './exec.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DeployResult { skipped: boolean; reason?: string; project: string | null; deploymentUrl: string | null; previewUrl: string | null; warnings: string[] }

let cliLoggedIn: boolean | null = null;
/** A token in .env, or the Vercel CLI already logged in on this machine. */
export async function deployAvailable(): Promise<{ ok: boolean; how: 'token' | 'cli' | null; detail: string }> {
  if (process.env.VERCEL_TOKEN) return { ok: true, how: 'token', detail: 'VERCEL_TOKEN' };
  if (cliLoggedIn === null) {
    const r = await run('vercel', ['whoami'], { cwd: process.cwd(), timeoutMs: 20_000 });
    cliLoggedIn = r.code === 0 && r.stdout.trim().length > 0;
    if (cliLoggedIn) return { ok: true, how: 'cli', detail: `vercel CLI logged in as ${r.stdout.trim().split('\n').pop()}` };
  }
  return cliLoggedIn ? { ok: true, how: 'cli', detail: 'vercel CLI logged in' } : { ok: false, how: null, detail: 'no VERCEL_TOKEN and vercel CLI not logged in (run: vercel login)' };
}
export function deployConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN) || cliLoggedIn === true;
}
const authArgs = () => [...(process.env.VERCEL_TOKEN ? ['--token', process.env.VERCEL_TOKEN] : []), ...(process.env.VERCEL_TEAM_ID ? ['--scope', process.env.VERCEL_TEAM_ID] : [])];

/** Create or reuse the Vercel project, deploy production with the preview flag, attach the subdomain, verify. */
/** Poll the API until the deployment is ready or has stopped for a reason. */
export async function waitForDeployment(url: string, say: (m: string) => void, timeoutMs = 12 * 60_000): Promise<{ state: string; error: string | null }> {
  const token = vercelToken();
  if (!token) return { state: 'READY', error: null };
  const tid = await teamId(token);
  const host = url.replace(/^https?:\/\//, '');
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetchWithTimeout(`https://api.vercel.com/v13/deployments/${host}${tid ? `?teamId=${tid}` : ''}`, { timeoutMs: 20_000, headers: { authorization: `Bearer ${token}` } });
      const d = (await res.json()) as { readyState?: string; errorMessage?: string; errorCode?: string };
      const st = d.readyState ?? 'UNKNOWN';
      if (st !== last) { say(`deployment ${st.toLowerCase()}`); last = st; }
      if (['READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(st)) return { state: st, error: d.errorMessage ?? d.errorCode ?? null };
    } catch { /* retry */ }
    await sleep(5000);
  }
  return { state: 'TIMEOUT', error: 'no final state within 12 minutes' };
}

export interface DeployOpts { log?: (m: string) => void; label: string }

/** Create or reuse the Vercel project, deploy production with the preview flag, attach the subdomain, verify. */
/** The token the CLI logged in with, so the pipeline can call the REST API without a separate token. */
function vercelToken(): string | null {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const f = join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json');
  if (!existsSync(f)) return null;
  try { return (JSON.parse(readFileSync(f, 'utf8')) as { token?: string }).token ?? null; } catch { return null; }
}

let teamIdCache: string | null | undefined;
async function teamId(token: string): Promise<string | null> {
  if (teamIdCache !== undefined) return teamIdCache;
  const want = process.env.VERCEL_TEAM_ID;
  if (want?.startsWith('team_')) return (teamIdCache = want);
  try {
    const res = await fetchWithTimeout('https://api.vercel.com/v2/teams', { timeoutMs: 20_000, headers: { authorization: `Bearer ${token}` } });
    const teams = ((await res.json()) as { teams?: { id: string; slug: string }[] }).teams ?? [];
    const t = want ? teams.find((x) => x.slug === want) : teams.length === 1 ? teams[0] : undefined;
    return (teamIdCache = t?.id ?? null);
  } catch { return (teamIdCache = null); }
}

/**
 * Vercel's default "Standard Protection" puts a login wall on every *.vercel.app URL, including production.
 * A preview a business owner must open needs production public, so protect preview deployments only.
 */
async function configureProject(project: string): Promise<string | null> {
  const token = vercelToken();
  if (!token) return 'no token available to configure the project (framework, deployment protection)';
  const tid = await teamId(token);
  const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}${tid ? `?teamId=${tid}` : ''}`;
  // framework: a project made with `vercel project add` has none, and without it Vercel serves nothing from a Next build.
  const body = { framework: 'nextjs', ssoProtection: { deploymentType: 'preview' } };
  const res = await fetchWithTimeout(url, { method: 'PATCH', timeoutMs: 20_000, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return `could not configure the project (${res.status}): ${(await res.text()).slice(0, 160)}`;
  return null;
}

/** Aliases the CLI reports for a deployment, team-suffixed one first because the bare one can be taken globally. */
async function aliasesOf(dir: string, deploymentUrl: string): Promise<string[]> {
  const r = await run('vercel', ['inspect', deploymentUrl, ...authArgs()], { cwd: dir, timeoutMs: 60_000 });
  const found = [...(r.stdout + r.stderr).matchAll(/https:\/\/[a-z0-9.-]+\.vercel\.app/g)].map((m) => m[0]).filter((u) => u !== deploymentUrl);
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

export async function deploySite(dir: string, slug: string, opts: DeployOpts): Promise<DeployResult> {
  const say = opts.log ?? (() => undefined);
  const avail = await deployAvailable();
  if (!avail.ok) return { skipped: true, reason: avail.detail, project: null, deploymentUrl: null, previewUrl: null, warnings: [] };
  const previewDomain = process.env.PREVIEW_DOMAIN ?? '';
  const project = `site-${opts.label}`;
  const warnings: string[] = [];
  const vercel = (args: string[], input?: string, timeoutMs = 120_000) => run('vercel', [...args, ...authArgs()], { cwd: dir, input, timeoutMs });

  say(`vercel project ${project} (${avail.detail})`);
  const add = await vercel(['project', 'add', project]);
  if (add.code !== 0 && !/already exists/i.test(add.stderr + add.stdout)) throw new Error(`vercel project add: ${(add.stderr || add.stdout).trim().slice(0, 300)}`);
  const link = await vercel(['link', '--yes', '--project', project]);
  if (link.code !== 0) throw new Error(`vercel link: ${(link.stderr || link.stdout).trim().slice(0, 300)}`);
  const hasRemote = (await run('git', ['remote'], { cwd: dir })).stdout.includes('origin');
  if (hasRemote) {
    const connect = await vercel(['git', 'connect', '--yes']);
    if (connect.code !== 0) warnings.push(`git connect: ${(connect.stderr || connect.stdout).trim().split('\n').pop()?.slice(0, 200)}`);
  }
  // Preview flag, the slug (so the site can count its own opens), and the shared open-counter store when configured.
  const envs: [string, string | undefined][] = [
    ['ACTA_PREVIEW', '1'], ['ACTA_SLUG', slug],
    ['UPSTASH_REDIS_REST_URL', process.env.UPSTASH_REDIS_REST_URL], ['UPSTASH_REDIS_REST_TOKEN', process.env.UPSTASH_REDIS_REST_TOKEN],
  ];
  for (const [name, value] of envs) {
    if (!value) continue;
    const envAdd = await vercel(['env', 'add', name, 'production', '--force'], value);
    if (envAdd.code !== 0 && !/already exists/i.test(envAdd.stderr + envAdd.stdout)) warnings.push(`env add ${name}: ${(envAdd.stderr || envAdd.stdout).trim().slice(0, 200)}`);
  }
  if (!process.env.UPSTASH_REDIS_REST_URL) say('preview opens not counted: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env to count them');

  const prot = await configureProject(project);
  if (prot) warnings.push(prot);

  say('vercel deploy --prod');
  // --no-wait returns as soon as the deployment exists; the API then says READY, or why not (BLOCKED, ERROR).
  // Without this the CLI sits at "Building…" forever when Vercel blocks a deployment.
  const dep = await vercel(['deploy', '--prod', '--yes', '--no-wait'], undefined, 10 * 60_000);
  const urls = (dep.stdout + '\n' + dep.stderr).match(/https:\/\/[^\s]+\.vercel\.app/g) ?? [];
  // The CLI prints the unique deployment URL and may also print the project alias; keep the unique one.
  const deploymentUrl = urls.find((u) => /-[a-z0-9]{9}-/.test(u)) ?? urls[0] ?? null;
  if (dep.code !== 0 || !deploymentUrl) {
    throw new Error(`vercel deploy failed: ${(dep.stderr || dep.stdout).trim().split('\n').slice(-6).join(' | ').slice(0, 600)}`);
  }
  const state = await waitForDeployment(deploymentUrl, (m) => say(m));
  if (state.state !== 'READY') throw new Error(`deployment ${state.state}${state.error ? `: ${state.error}` : ''}`);

  const candidates: string[] = [];
  if (previewDomain) {
    const domain = `${opts.label}.${previewDomain}`;
    const dom = await vercel(['domains', 'add', domain, project]);
    if (dom.code !== 0 && !/already/i.test(dom.stderr + dom.stdout)) warnings.push(`domain ${domain}: ${(dom.stderr || dom.stdout).trim().split('\n').pop()?.slice(0, 200)}`);
    else candidates.push(`https://${domain}`);
  }
  candidates.push(...await aliasesOf(dir, deploymentUrl), deploymentUrl);

  say(`verifying ${candidates.join(', ')}`);
  let previewUrl: string | null = null;
  for (let attempt = 0; attempt < 6 && !previewUrl; attempt++) {
    for (const url of candidates) {
      try {
        const res = await fetchWithTimeout(url, { timeoutMs: 15_000, redirect: 'manual' });
        const robots = res.headers.get('x-robots-tag') ?? '';
        if (res.status === 200) {
          if (!/noindex/i.test(robots)) warnings.push(`${url} is up but missing the noindex header`);
          previewUrl = url;
          break;
        }
      } catch { /* try the next */ }
    }
    if (!previewUrl) await sleep(10_000);
  }
  if (!previewUrl) {
    warnings.push('no public URL answered 200: deployment protection may still be on, or DNS has not propagated. Falling back to the deployment URL');
    previewUrl = deploymentUrl;
  }
  return { skipped: false, project, deploymentUrl, previewUrl, warnings };
}

export async function teardownDeploy(dir: string, label: string): Promise<string[]> {
  const avail = await deployAvailable();
  if (!avail.ok) return [`${avail.detail}: nothing removed on Vercel`];
  const notes: string[] = [];
  const project = `site-${label}`;
  const previewDomain = process.env.PREVIEW_DOMAIN;
  if (previewDomain) { const r = await run('vercel', ['domains', 'rm', `${label}.${previewDomain}`, '--yes', ...authArgs()], { cwd: dir }); notes.push(`domain rm: ${r.code === 0 ? 'ok' : 'skipped'}`); }
  // `project rm` has no --yes in this CLI; it asks for the project name on stdin.
  const r = await run('vercel', ['project', 'rm', project, ...authArgs()], { cwd: dir, input: `${project}\n`, timeoutMs: 60_000 });
  notes.push(`project rm: ${r.code === 0 ? 'ok' : (r.stderr || r.stdout).trim().split('\n').pop()?.slice(0, 120)}`);
  return notes;
}
