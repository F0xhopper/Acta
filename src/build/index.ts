/**
 * acta build: a picked lead to a reviewed, deployed preview, one recorded step at a time.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { envInt } from '../config.js';
import { getFullLead, setStatus } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import type { Budget } from '../discover/places.js';
import { findPack } from '../report/format.js';
import { writeLeaderboard } from '../report/leaderboard.js';
import { agentAvailable, runAgent } from './agent.js';
import { loadGather, loadResearch, type GatherResult } from './apis.js';
import { BrandSchema, FactsSchema, SITE_PATHS, type GateReport } from './contracts.js';
import { deployConfigured, deploySite, teardownDeploy } from './deploy.js';
import { makeEvidence } from './evidence.js';
import { runGates, takeShots } from './gates.js';
import { buildDir, buildLogger } from './log.js';
import { ensureBuild, failBuild, getBuild, setBuildState, updateBuild, type BuildRow } from './queries.js';
import { commitAll, copyStarter, createRemote, ensureGit, headSha, installDeps, pushMain, siteDir, writeFile } from './repo.js';
import { resolveLead } from './resolve.js';
import { siteContentSource } from './site-content.js';
import { STEP_TARGET, stepsFrom, type Step } from './state.js';
import { checkUniqueness } from './unique.js';
import { run } from './exec.js';

export interface BuildOpts {
  budget: Budget;
  sandbox?: boolean;       // no GitHub, no Vercel
  deploy?: boolean;        // default: when VERCEL_TOKEN is set and not sandbox
  agent?: boolean;         // default true; false = infrastructure only, placeholder design
  research?: boolean;      // default true
  force?: boolean;         // re-gather and re-copy the starter
  fastGates?: boolean;     // skip Lighthouse
  maxTurns?: number;
  maxMinutes?: number;
  dryRun?: boolean;
}

interface Ctx { full: FullLead; slug: string; dir: string; log: ReturnType<typeof buildLogger>; opts: BuildOpts; gather?: GatherResult }

const MAX_ATTEMPTS: Record<Step, number> = { gather: 2, repo: 3, research: 1, agent: 1, gate: 2, push: 3, deploy: 3, evidence: 2 };

function readJson<T>(p: string): T { return JSON.parse(readFileSync(p, 'utf8')) as T; }

// ---------- steps ----------

async function stepGather(ctx: Ctx) {
  const api = await loadGather();
  ctx.gather = await api.gather(ctx.full, { force: ctx.opts.force, log: (m) => ctx.log.info('gather', m), onRequest: () => { ctx.opts.budget.used++; } });
  const b = ctx.gather.brand;
  ctx.log.info('gather', `logo ${b.logo.quality} (${b.logo.source}), palette ${b.palette.primary ?? 'none'}/${b.palette.secondary ?? 'none'} (${b.palette.confidence}), ${b.photos.length} photos, ${ctx.gather.facts.claims.length} claims, ${ctx.gather.facts.services.length} services`);
  updateBuild(ctx.full.lead.id, { brand_json_path: ctx.gather.files.brand });
}

async function stepRepo(ctx: Ctx) {
  const api = await loadGather();
  ctx.gather ??= await api.gather(ctx.full, { log: (m) => ctx.log.info('gather', m) });
  const dir = copyStarter(ctx.slug, ctx.opts.force);
  ctx.dir = dir;
  api.copyIntoRepo(ctx.gather, dir);
  // Use the copies inside the repo: their asset paths are repo-relative, the cached ones are not.
  const brandInRepo = BrandSchema.parse(readJson(join(dir, SITE_PATHS.brand)));
  const factsInRepo = FactsSchema.parse(readJson(join(dir, SITE_PATHS.facts)));
  writeFile(dir, SITE_PATHS.site, siteContentSource(brandInRepo, factsInRepo));
  ctx.log.info('repo', `starter copied to ${dir}, brand and facts seeded`);
  await installDeps(dir);
  await ensureGit(dir);
  const seed = await commitAll(dir, `chore: seed from Acta (${ctx.slug}, ${new Date().toISOString().slice(0, 10)})`) ?? await headSha(dir);
  let repoUrl: string | null = null;
  if (!ctx.opts.sandbox) {
    repoUrl = await createRemote(dir, ctx.slug, `Acta preview for ${ctx.full.lead.name}`);
    ctx.log.info('repo', `GitHub ${repoUrl}`);
  } else ctx.log.info('repo', 'sandbox: no GitHub repo created');
  updateBuild(ctx.full.lead.id, { repo_dir: dir, repo_url: repoUrl, seed_sha: seed, head_sha: seed });
}

async function stepResearch(ctx: Ctx) {
  if (ctx.opts.research === false) { ctx.log.info('research', 'skipped by flag'); return; }
  const brand = BrandSchema.parse(readJson(join(ctx.dir, SITE_PATHS.brand)));
  const facts = FactsSchema.parse(readJson(join(ctx.dir, SITE_PATHS.facts)));
  const api = await loadResearch();
  const sessionPath = join(buildDir('_sessions'), 'pinterest.json');
  const r = await api.researchLead(brand, facts, join(ctx.dir, SITE_PATHS.research), { sessionPath, log: (m) => ctx.log.info('research', m) });
  ctx.log.info('research', `${r.pins} pins from ${r.queries.length} searches${r.fallback ? ' (Pinterest unavailable, used fallback)' : ''} -> ${r.boardPath}`);
  updateBuild(ctx.full.lead.id, { research_fallback: r.fallback ? 1 : 0 });
  await commitAll(ctx.dir, 'chore: research board');
}

async function stepAgent(ctx: Ctx, prompt = '/build') {
  if (ctx.opts.agent === false) {
    ctx.log.warn('agent', 'skipped by flag: the site keeps the unstyled placeholder design');
    writeFile(ctx.dir, SITE_PATHS.buildLog, `# Build log\n\nAgent skipped (--no-agent). Placeholder design only.\n`);
    await commitAll(ctx.dir, 'chore: agent skipped');
    return;
  }
  if (!agentAvailable()) throw new Error('claude CLI not found on PATH');
  const resultPath = join(buildDir(ctx.slug), `agent-${prompt.replace('/', '')}-${Date.now()}.json`);
  const r = await runAgent(ctx.dir, { prompt, maxTurns: ctx.opts.maxTurns ?? envInt('BUILD_MAX_TURNS', 200), maxMinutes: ctx.opts.maxMinutes ?? envInt('BUILD_MAX_MINUTES', 150), resultPath, log: (m) => ctx.log.info('agent', m) });
  const left = await commitAll(ctx.dir, 'wip: changes left uncommitted by the agent');
  if (left) ctx.log.warn('agent', 'committed changes the agent left uncommitted');
  updateBuild(ctx.full.lead.id, { agent_result_path: resultPath, agent_turns: r.turns, agent_seconds: r.seconds, agent_cost_usd: r.costUsd, head_sha: await headSha(ctx.dir), built_at: new Date().toISOString() });
  if (!r.ok) {
    const limit = /session limit|usage limit|rate limit|resets? \d/i.test(r.message);
    throw new Error(limit
      ? `paused: ${r.message.slice(0, 200)}. Work so far is committed; run the same build command after the reset and it continues from the artefacts in acta/.`
      : `agent ${r.timedOut ? 'timed out' : 'failed'}: ${r.message.slice(0, 400)}`);
  }
  if (!existsSync(join(ctx.dir, SITE_PATHS.buildLog))) ctx.log.warn('agent', 'no build log written');
}

/** With no agent there is no design, so the two gates that judge the design become warnings. */
function tolerateDesignGates(ctx: Ctx, g: Awaited<ReturnType<typeof runGates>>) {
  if (ctx.opts.agent !== false || !g.report) return g;
  const design = new Set(['brand', 'images']);
  const failing = g.failing.filter((f) => !design.has(f.split(/[ (:]/)[0]));
  const tolerated = g.failing.filter((f) => design.has(f.split(/[ (:]/)[0]));
  for (const t of tolerated) ctx.log.warn('gate', `tolerated with --no-agent: ${t}`);
  return { ...g, failing, passed: failing.length === 0 };
}

async function stepGate(ctx: Ctx) {
  await commitAll(ctx.dir, 'wip: pre-gate');
  let g = tolerateDesignGates(ctx, await runGates(ctx.dir, { fast: ctx.opts.fastGates, log: (m) => ctx.log.info('gate', m) }));
  if (!g.passed && ctx.opts.agent !== false) {
    ctx.log.warn('gate', `failed: ${g.failing.join(' | ')}. Asking the agent to revise once.`);
    writeFile(ctx.dir, SITE_PATHS.reviewNotes, `# Gate failures to fix\n\n${g.failing.map((f) => `- ${f}`).join('\n')}\n`);
    await commitAll(ctx.dir, 'chore: gate failures for revision');
    await stepAgent(ctx, '/revise');
    g = await runGates(ctx.dir, { fast: ctx.opts.fastGates, log: (m) => ctx.log.info('gate', m) });
  }
  if (!g.passed) throw new Error(`gates failed: ${g.failing.join(' | ')}${g.error ? ` (${g.error})` : ''}`);
  ctx.log.info('gate', `passed: ${g.report?.gates.map((x) => x.name).join(', ')}`);

  const shots = await takeShots(ctx.dir, (m) => ctx.log.warn('gate', m));
  if (shots) {
    const u = await checkUniqueness(ctx.slug, shots.hero, shots.mobile);
    if (!u.unique && ctx.opts.agent !== false) {
      ctx.log.warn('gate', `too similar to ${u.nearest?.slug} (hero ${u.nearest?.hero.toFixed(2)}, page ${u.nearest?.page.toFixed(2)}); asking for a different layout`);
      writeFile(ctx.dir, SITE_PATHS.reviewNotes, `# Not unique enough\n\nThe home page looks too much like another Acta site (${u.nearest?.slug}). Change the layout concept: different hero composition, section order and rhythm. Keep the brand.\n`);
      await commitAll(ctx.dir, 'chore: uniqueness note');
      await stepAgent(ctx, '/revise');
      const g2 = await runGates(ctx.dir, { fast: ctx.opts.fastGates, log: (m) => ctx.log.info('gate', m) });
      if (!g2.passed) throw new Error(`gates failed after uniqueness revision: ${g2.failing.join(' | ')}`);
      const s2 = await takeShots(ctx.dir);
      const u2 = s2 ? await checkUniqueness(ctx.slug, s2.hero, s2.mobile) : u;
      if (!u2.unique) throw new Error(`still too similar to ${u2.nearest?.slug}`);
    } else if (u.nearest) ctx.log.info('gate', `unique: nearest ${u.nearest.slug} at ${Math.max(u.nearest.hero, u.nearest.page).toFixed(2)}`);
    else ctx.log.info('gate', 'unique: first site built');
  }
  updateBuild(ctx.full.lead.id, { gate_json_path: join(ctx.dir, SITE_PATHS.gate), head_sha: await headSha(ctx.dir) });
}

async function stepPush(ctx: Ctx) {
  if (ctx.opts.sandbox) { ctx.log.info('push', 'sandbox: nothing pushed'); return; }
  await pushMain(ctx.dir);
  ctx.log.info('push', `pushed ${(await headSha(ctx.dir)).slice(0, 7)} to origin/main`);
  const ci = await run('gh', ['run', 'list', '--limit', '1', '--json', 'status,conclusion,url'], { cwd: ctx.dir });
  if (ci.code === 0 && ci.stdout.trim().startsWith('[') && ci.stdout.includes('url')) ctx.log.info('push', `CI: ${ci.stdout.trim().slice(0, 200)}`);
}

async function stepDeploy(ctx: Ctx) {
  const want = ctx.opts.deploy ?? (!ctx.opts.sandbox && deployConfigured());
  if (!want) { ctx.log.warn('deploy', deployConfigured() ? 'skipped by flag' : 'skipped: VERCEL_TOKEN not set. Run the site locally with `pnpm dev` in the repo, or add the token and rerun.'); return; }
  const d = await deploySite(ctx.dir, ctx.slug, { log: (m) => ctx.log.info('deploy', m) });
  for (const w of d.warnings) ctx.log.warn('deploy', w);
  updateBuild(ctx.full.lead.id, { vercel_project: d.project, deployment_url: d.deploymentUrl, preview_url: d.previewUrl, deployed_at: new Date().toISOString() });
  ctx.log.info('deploy', `live at ${d.previewUrl}`);
}

async function stepEvidence(ctx: Ctx) {
  const b = getBuild(ctx.full.lead.id)!;
  const gate = existsSync(join(ctx.dir, SITE_PATHS.gate)) ? (readJson(join(ctx.dir, SITE_PATHS.gate)) as GateReport) : null;
  const after = join(ctx.dir, SITE_PATHS.qa, 'mobile.png');
  const out = join(ctx.dir, SITE_PATHS.qa, 'compare.png');
  await makeEvidence(getFullLead(ctx.slug)!, existsSync(after) ? after : null, b.preview_url, gate, out);
  const pack = findPack(ctx.slug);
  if (pack) copyFileSync(out, join(dirname(pack), 'compare.png'));
  const copy = join(buildDir(ctx.slug), 'compare.png');
  copyFileSync(out, copy);
  await commitAll(ctx.dir, 'chore: evidence');
  updateBuild(ctx.full.lead.id, { evidence_path: copy });
  setStatus(ctx.slug, 'preview_ready', b.preview_url ? `preview ${b.preview_url}` : 'preview built locally');
  ctx.log.info('evidence', `${copy}${pack ? ' (copied to the pitch pack)' : ''}`);
}

const STEP_FN: Record<Step, (ctx: Ctx) => Promise<void>> = { gather: stepGather, repo: stepRepo, research: stepResearch, agent: stepAgent, gate: stepGate, push: stepPush, deploy: stepDeploy, evidence: stepEvidence };

// ---------- driver ----------

export interface BuildOutcome { slug: string; name: string; state: string; repoUrl: string | null; previewUrl: string | null; evidence: string | null; dir: string; error: string | null }

export async function buildLead(input: string, opts: BuildOpts): Promise<BuildOutcome> {
  const full = await resolveLead(input, { budget: opts.budget, log: (m) => console.log(`  ${m}`) });
  const slug = full.lead.slug;
  const log = buildLogger(full.lead.id, slug);
  let row: BuildRow = ensureBuild(full.lead.id);
  if (opts.force && row.state !== 'picked') { setBuildState(full.lead.id, 'picked'); row = getBuild(full.lead.id)!; }
  const ctx: Ctx = { full, slug, dir: row.repo_dir ?? siteDir(slug), log, opts };
  const steps = stepsFrom(row.state, row.failed_step);
  if (opts.dryRun) {
    console.log(`Would run for ${full.lead.name} (${slug}), currently ${row.state}: ${steps.join(' -> ') || 'nothing, already preview_ready'}`);
    console.log(`  sandbox=${!!opts.sandbox} agent=${opts.agent !== false} research=${opts.research !== false} deploy=${opts.deploy ?? (!opts.sandbox && deployConfigured())}`);
    return { slug, name: full.lead.name, state: row.state, repoUrl: row.repo_url, previewUrl: row.preview_url, evidence: row.evidence_path, dir: ctx.dir, error: null };
  }
  if (!steps.length) log.info(null, `already ${row.state}, nothing to do (use --force to rebuild)`);
  else { log.info(null, `starting at ${steps[0]} (${steps.length} steps)`); setStatus(slug, 'building'); }
  for (const step of steps) {
    const max = MAX_ATTEMPTS[step];
    let attempt = 0;
    let done = false;
    while (!done) {
      attempt++;
      updateBuild(full.lead.id, { step_attempts: attempt });
      try {
        await STEP_FN[step](ctx);
        setBuildState(full.lead.id, STEP_TARGET[step]);
        done = true;
      } catch (e) {
        const msg = (e as Error).message;
        log.error(step, `attempt ${attempt}/${max} failed: ${msg}`);
        if (attempt >= max) {
          failBuild(full.lead.id, step, msg, attempt);
          setStatus(slug, 'building', `build failed at ${step}`);
          writeLeaderboard();
          return { slug, name: full.lead.name, state: 'failed', repoUrl: getBuild(full.lead.id)?.repo_url ?? null, previewUrl: null, evidence: null, dir: ctx.dir, error: `${step}: ${msg}` };
        }
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
  const final = getBuild(full.lead.id)!;
  writeLeaderboard();
  return { slug, name: full.lead.name, state: final.state, repoUrl: final.repo_url, previewUrl: final.preview_url, evidence: final.evidence_path, dir: ctx.dir, error: null };
}

// ---------- review ----------

export function approve(slug: string): string {
  const full = getFullLead(slug);
  if (!full) return `No lead ${slug}`;
  const b = getBuild(full.lead.id);
  if (!b || b.state !== 'preview_ready') return `${slug} is ${b?.state ?? 'not built'}, only preview_ready can be approved`;
  setBuildState(full.lead.id, 'approved', { reviewed_at: new Date().toISOString() });
  setStatus(slug, 'preview_ready', 'approved for outreach');
  writeLeaderboard();
  return `${full.lead.name}: approved. Preview ${b.preview_url ?? '(local only)'}`;
}

export async function reject(slug: string, note: string, opts: BuildOpts): Promise<BuildOutcome> {
  const full = getFullLead(slug);
  if (!full) throw new Error(`No lead ${slug}`);
  const b = getBuild(full.lead.id);
  if (!b || !['preview_ready', 'approved', 'failed'].includes(b.state)) throw new Error(`${slug} is ${b?.state ?? 'not built'}`);
  const dir = b.repo_dir ?? siteDir(slug);
  const notes = join(dir, SITE_PATHS.reviewNotes);
  mkdirSync(dirname(notes), { recursive: true });
  writeFileSync(notes, `# Review note (${new Date().toISOString().slice(0, 10)})\n\n${note}\n`);
  await commitAll(dir, 'chore: review note');
  setBuildState(full.lead.id, 'revising', { review_note: note, reviewed_at: new Date().toISOString() });
  return buildLead(slug, opts);
}

export async function teardown(slug: string, opts: { keepRepo?: boolean } = {}): Promise<string[]> {
  const full = getFullLead(slug);
  if (!full) return [`No lead ${slug}`];
  const b = getBuild(full.lead.id);
  if (!b) return [`${slug} was never built`];
  const notes: string[] = [];
  const dir = b.repo_dir ?? siteDir(slug);
  if (existsSync(dir)) notes.push(...await teardownDeploy(dir, slug));
  if (b.repo_url && !opts.keepRepo) {
    const r = await run('gh', ['repo', 'archive', b.repo_url, '--yes'], { cwd: process.cwd() });
    notes.push(`GitHub archive: ${r.code === 0 ? 'ok' : (r.stderr || r.stdout).trim().split('\n').pop()?.slice(0, 120)}`);
  }
  setBuildState(full.lead.id, 'torn_down', { torn_down_at: new Date().toISOString() });
  writeLeaderboard();
  return notes;
}
