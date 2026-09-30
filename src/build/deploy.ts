import { fetchWithTimeout, sleep } from '../util/http.js';
import { env } from '../config.js';
import { run } from './exec.js';
import { repoName } from './repo.js';

export interface DeployResult { skipped: boolean; reason?: string; project: string | null; deploymentUrl: string | null; previewUrl: string | null; warnings: string[] }

export function deployConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN);
}

/** Create or reuse the Vercel project, deploy production with the preview flag, attach the subdomain, verify. */
export async function deploySite(dir: string, slug: string, opts: { log?: (m: string) => void } = {}): Promise<DeployResult> {
  const say = opts.log ?? (() => undefined);
  if (!deployConfigured()) return { skipped: true, reason: 'VERCEL_TOKEN not set', project: null, deploymentUrl: null, previewUrl: null, warnings: [] };
  const token = env('VERCEL_TOKEN');
  const scope = process.env.VERCEL_TEAM_ID ? ['--scope', process.env.VERCEL_TEAM_ID] : [];
  const previewDomain = process.env.PREVIEW_DOMAIN ?? '';
  const project = repoName(slug);
  const warnings: string[] = [];
  const vercel = (args: string[], input?: string, timeoutMs = 120_000) => run('vercel', [...args, '--token', token, ...scope], { cwd: dir, input, timeoutMs });

  say(`vercel project ${project}`);
  const add = await vercel(['project', 'add', project]);
  if (add.code !== 0 && !/already exists/i.test(add.stderr + add.stdout)) throw new Error(`vercel project add: ${(add.stderr || add.stdout).trim().slice(0, 300)}`);
  const link = await vercel(['link', '--yes', '--project', project]);
  if (link.code !== 0) throw new Error(`vercel link: ${(link.stderr || link.stdout).trim().slice(0, 300)}`);
  const connect = await vercel(['git', 'connect', '--yes']);
  if (connect.code !== 0) warnings.push(`git connect: ${(connect.stderr || connect.stdout).trim().split('\n').pop()?.slice(0, 200)}`);
  const envAdd = await vercel(['env', 'add', 'ACTA_PREVIEW', 'production'], '1');
  if (envAdd.code !== 0 && !/already exists/i.test(envAdd.stderr + envAdd.stdout)) warnings.push(`env add: ${(envAdd.stderr || envAdd.stdout).trim().slice(0, 200)}`);

  say('vercel deploy --prod');
  const dep = await vercel(['deploy', '--prod', '--yes'], undefined, 15 * 60_000);
  const urlMatch = (dep.stdout + '\n' + dep.stderr).match(/https:\/\/[^\s]+\.vercel\.app/g);
  const deploymentUrl = urlMatch ? urlMatch[urlMatch.length - 1] : null;
  if (dep.code !== 0 || !deploymentUrl) {
    const logs = await vercel(['logs', deploymentUrl ?? project], undefined, 60_000);
    throw new Error(`vercel deploy failed: ${(dep.stderr || dep.stdout).trim().split('\n').slice(-5).join(' | ').slice(0, 400)} ${logs.stdout.trim().split('\n').slice(-5).join(' | ').slice(0, 400)}`);
  }
  const wait = await vercel(['inspect', deploymentUrl, '--wait', '--timeout', '10m'], undefined, 11 * 60_000);
  if (wait.code !== 0) warnings.push('inspect --wait did not confirm READY, verifying by fetch');

  let previewUrl = deploymentUrl;
  if (previewDomain) {
    const domain = `${slug}.${previewDomain}`;
    const dom = await vercel(['domains', 'add', domain, project]);
    if (dom.code !== 0 && !/already/i.test(dom.stderr + dom.stdout)) warnings.push(`domain ${domain}: ${(dom.stderr || dom.stdout).trim().split('\n').pop()?.slice(0, 200)}`);
    else previewUrl = `https://${domain}`;
  }

  say(`verifying ${previewUrl}`);
  let verified = false;
  for (let i = 0; i < 8 && !verified; i++) {
    try {
      const res = await fetchWithTimeout(previewUrl, { timeoutMs: 15_000 });
      const robots = res.headers.get('x-robots-tag') ?? '';
      if (res.status === 200 && /noindex/i.test(robots)) verified = true;
      else if (res.status === 200) { warnings.push('site is up but missing the noindex header'); verified = true; }
    } catch { /* retry */ }
    if (!verified) await sleep(10_000);
  }
  if (!verified && previewUrl !== deploymentUrl) {
    warnings.push(`${previewUrl} not reachable yet (DNS?), falling back to the deployment URL`);
    previewUrl = deploymentUrl;
  }
  return { skipped: false, project, deploymentUrl, previewUrl, warnings };
}

export async function teardownDeploy(dir: string, slug: string): Promise<string[]> {
  if (!deployConfigured()) return ['VERCEL_TOKEN not set, nothing to remove on Vercel'];
  const token = env('VERCEL_TOKEN');
  const scope = process.env.VERCEL_TEAM_ID ? ['--scope', process.env.VERCEL_TEAM_ID] : [];
  const notes: string[] = [];
  const project = repoName(slug);
  const previewDomain = process.env.PREVIEW_DOMAIN;
  if (previewDomain) { const r = await run('vercel', ['domains', 'rm', `${slug}.${previewDomain}`, '--yes', '--token', token, ...scope], { cwd: dir }); notes.push(`domain rm: ${r.code === 0 ? 'ok' : 'skipped'}`); }
  const r = await run('vercel', ['project', 'rm', project, '--yes', '--token', token, ...scope], { cwd: dir });
  notes.push(`project rm: ${r.code === 0 ? 'ok' : (r.stderr || r.stdout).trim().split('\n').pop()?.slice(0, 120)}`);
  return notes;
}
