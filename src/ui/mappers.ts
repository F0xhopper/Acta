/** Database rows and site files to the API contract. Pure where possible, so they can be tested without a database. */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.js';
import type { FullLead } from '../db/types.js';
import type { BuildRow } from '../build/queries.js';
import { conceptChosen, loadCheckpoints, photosCurated } from '../build/checkpoints.js';
import { hook, reasonsOf } from '../report/format.js';
import { describeLead, reviewsOf } from '../report/describe.js';
import { displayUkPhone } from '../util/phone.js';
import type {
  AgentProgress, BuildState, BuildSummary, BusinessTab, Device, LeadDetail, LeadSummary, NextAction, PageShots, PipelineStatus, RailStep, Tier, TimelineEntry,
} from './api-types.js';
import { fileUrl } from './files.js';

export const categoryLabel = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const siteDir = (slug: string) => join(ROOT, 'sites', slug);

export function toLeadSummary(full: FullLead, buildState: string | null): LeadSummary {
  const { lead, audit, score, ch, pipeline } = full;
  return {
    slug: lead.slug,
    name: lead.name,
    category: lead.category_key,
    categoryLabel: categoryLabel(lead.category_key),
    area: lead.area,
    address: lead.address,
    rating: lead.rating,
    reviews: lead.review_count ?? 0,
    phone: lead.phone_e164 ? displayUkPhone(lead.phone_e164) : null,
    websiteStatus: audit?.website_status ?? null,
    websiteUrl: audit?.final_url ?? lead.website_url ?? null,
    tier: (score?.tier as Tier | undefined) ?? null,
    score: score?.total ?? null,
    opportunity: score?.opportunity ?? null,
    viability: score?.viability ?? null,
    channel: score?.channel ?? null,
    ltd: ch?.match_confidence === 'high',
    status: pipeline.status as PipelineStatus,
    buildState: (buildState as BuildState | null) ?? null,
    hook: hook(full),
    reasons: score ? reasonsOf(full) : [],
    mapsUrl: lead.google_maps_url,
    sourceQuery: lead.source_query,
    discoveredAt: lead.discovered_at,
  };
}

/** Status history lives as dated lines in pipeline.notes ("2026-10-06: approved for outreach"). */
export function notesTimeline(notes: string | null): TimelineEntry[] {
  if (!notes) return [];
  return notes.split('\n').map((l) => l.match(/^(\d{4}-\d{2}-\d{2}):\s*(.*)$/)).filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ at: `${m[1]}T12:00:00.000Z`, kind: 'status' as const, text: m[2].charAt(0).toUpperCase() + m[2].slice(1) }));
}

/** The one thing to do next for a business. Pure. */
export function nextActionFor(status: PipelineStatus, build: Pick<BuildSummary, 'state' | 'failedStep' | 'activeJobId'> | null, sent: boolean): NextAction | null {
  const s = build?.state;
  if (status === 'lost' || status === 'do_not_contact' || status === 'won') return null;
  if (s === 'failed') return { label: `Retry from ${build!.failedStep ?? 'the start'}`, tab: 'progress', kind: 'failed' };
  if (s === 'awaiting_photos') return { label: 'Sort the photos', tab: 'photos', kind: 'photos' };
  if (s === 'awaiting_concept') return { label: 'Choose a concept', tab: 'concepts', kind: 'concept' };
  if (build?.activeJobId || (s && ['picked', 'gathered', 'repo_ready', 'researched', 'built', 'gated', 'pushed', 'deployed', 'revising'].includes(s) && status === 'building')) return { label: 'Watch the build', tab: 'progress', kind: 'wait' };
  if (s === 'preview_ready') return { label: 'Review the site', tab: 'review', kind: 'review' };
  if (s === 'approved' && !sent && status === 'preview_ready') return { label: 'Send the pitch', tab: 'deliver', kind: 'send' };
  if (status === 'replied') return { label: 'Log the outcome', tab: 'overview', kind: 'reply' };
  if (status === 'new' || status === 'shortlisted') return { label: 'Build the site', tab: 'overview', kind: 'build' };
  if (!build || s === 'torn_down') return { label: 'Build the site', tab: 'overview', kind: 'build' };
  return null;
}

export function toLeadDetail(full: FullLead, build: BuildSummary | null, extraTimeline: TimelineEntry[], sent: boolean): LeadDetail {
  const base = toLeadSummary(full, build?.state ?? null);
  const a = full.audit;
  let hours: string[] = [];
  try { hours = full.lead.opening_hours_json ? JSON.parse(full.lead.opening_hours_json) : []; } catch { /* none */ }
  const timeline = [...notesTimeline(full.pipeline.notes ?? null), ...extraTimeline, { at: full.lead.discovered_at, kind: 'note' as const, text: `Found by the search "${full.lead.source_query}"` }]
    .sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 80);
  return {
    ...base,
    description: describeLead(full),
    hours,
    reviewsList: reviewsOf(full).map((r) => ({ rating: r.rating, text: r.text, author: r.author, when: r.when })),
    audit: a ? {
      lhPerf: a.lh_perf, lhSeo: a.lh_seo,
      viewport: a.has_viewport === null ? null : a.has_viewport === 1,
      https: a.https_ok === null ? null : a.https_ok === 1,
      builder: a.builder, copyrightYear: a.copyright_year,
    } : null,
    currentSiteShot: fileUrl('shots', full.lead.slug, a?.screenshot_mobile ?? null),
    timeline,
    build,
    nextAction: nextActionFor(base.status, build, sent),
  };
}

// ---------- the build rail ----------

const ORDER: BuildState[] = ['picked', 'gathered', 'repo_ready', 'awaiting_photos', 'researched', 'awaiting_concept', 'built', 'gated', 'pushed', 'deployed', 'preview_ready'];
const RAIL: { key: string; label: string; checkpoint: boolean; doneAt: BuildState; step: string }[] = [
  { key: 'gather', label: 'Gather', checkpoint: false, doneAt: 'gathered', step: 'gather' },
  { key: 'repo', label: 'Set up', checkpoint: false, doneAt: 'repo_ready', step: 'repo' },
  { key: 'photos', label: 'Photos', checkpoint: true, doneAt: 'researched', step: 'research' },
  { key: 'research', label: 'Research', checkpoint: false, doneAt: 'researched', step: 'research' },
  { key: 'concepts', label: 'Concepts', checkpoint: true, doneAt: 'built', step: 'agent' },
  { key: 'agent', label: 'Design and build', checkpoint: false, doneAt: 'built', step: 'agent' },
  { key: 'gate', label: 'Checks', checkpoint: false, doneAt: 'gated', step: 'gate' },
  { key: 'push', label: 'Push', checkpoint: false, doneAt: 'pushed', step: 'push' },
  { key: 'deploy', label: 'Deploy', checkpoint: false, doneAt: 'deployed', step: 'deploy' },
  { key: 'evidence', label: 'Evidence', checkpoint: false, doneAt: 'preview_ready', step: 'evidence' },
];
const STEP_ORDER = ['gather', 'repo', 'research', 'agent', 'gate', 'push', 'deploy', 'evidence'];

export interface RailFacts { curated: boolean; chosen: boolean; photosOn: boolean; conceptOn: boolean }

/** The rail for a build state. Pure. */
export function buildRail(state: BuildState, failedStep: string | null, running: boolean, f: RailFacts): RailStep[] {
  const finished = ['preview_ready', 'approved', 'live'].includes(state);
  const idx = finished ? ORDER.length : ORDER.indexOf(state);
  const out: RailStep[] = RAIL.map((r) => {
    let status: RailStep['status'];
    if (state === 'torn_down') status = 'todo';
    else if (state === 'failed') {
      const fi = STEP_ORDER.indexOf(failedStep ?? 'gather');
      const si = STEP_ORDER.indexOf(r.step);
      status = si < fi ? 'done' : si === fi && !r.checkpoint ? 'failed' : 'todo';
      if (r.key === 'photos' && fi > STEP_ORDER.indexOf('repo')) status = f.curated ? 'done' : 'skipped';
      if (r.key === 'concepts' && f.chosen) status = 'done';
    } else if (state === 'revising') {
      status = STEP_ORDER.indexOf(r.step) < STEP_ORDER.indexOf('agent') || r.checkpoint ? 'done' : 'todo';
      if (r.key === 'photos' && !f.curated) status = 'skipped';
      if (r.key === 'concepts' && !f.chosen) status = 'skipped';
    } else {
      status = idx >= ORDER.indexOf(r.doneAt) ? 'done' : 'todo';
      if (r.key === 'photos') {
        if (state === 'awaiting_photos') status = 'waiting';
        else if (f.curated) status = 'done';
        else if (status === 'done' || idx > ORDER.indexOf('awaiting_photos')) status = 'skipped';
        else if (!f.photosOn) status = 'skipped';
      }
      if (r.key === 'concepts') {
        if (state === 'awaiting_concept') status = 'waiting';
        else if (f.chosen) status = 'done';
        else if (status === 'done') status = 'skipped';
        else if (!f.conceptOn) status = 'skipped';
      }
    }
    return { key: r.key, label: r.label, checkpoint: r.checkpoint, status };
  });
  if (running && !finished && state !== 'failed') {
    const cur = out.find((s) => s.status === 'todo' || (s.status === 'waiting' && false));
    if (cur) cur.status = 'current';
  }
  return out;
}

export function toBuildSummary(b: BuildRow & { slug: string; name: string }, activeJobId: number | null, rounds: number): BuildSummary {
  const dir = b.repo_dir ?? siteDir(b.slug);
  const hero = join(siteDir(b.slug), 'acta', 'qa', 'hero-mobile.png');
  const cp = loadCheckpoints();
  const facts: RailFacts = { curated: existsSync(dir) && photosCurated(dir), chosen: existsSync(dir) && conceptChosen(dir), photosOn: cp.photos, conceptOn: cp.concept };
  return {
    slug: b.slug,
    name: b.name,
    state: b.state as BuildState,
    failedStep: b.failed_step,
    lastError: b.last_error,
    previewUrl: b.preview_url,
    repoUrl: b.repo_url,
    evidenceUrl: b.evidence_path ? fileUrl('build', b.slug, b.evidence_path) : null,
    heroShotUrl: fileUrl('site', b.slug, hero),
    agentMinutes: b.agent_seconds !== null ? Math.round(b.agent_seconds / 60) : null,
    agentTurns: b.agent_turns,
    agentCostUsd: b.agent_cost_usd,
    updatedAt: b.updated_at,
    reviewedAt: b.reviewed_at,
    reviewNote: b.review_note,
    rail: buildRail(b.state as BuildState, b.failed_step, activeJobId !== null, facts),
    activeJobId,
    rounds,
  };
}

// ---------- screenshots ----------

const DEVICES: Device[] = ['mobile', 'tablet', 'desktop'];
const pageLabel = (path: string) => (path === '/' ? 'Home' : path.split('/').filter(Boolean).map((s) => s.replace(/-/g, ' ')).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' / '));

/** Full-page screenshots in a folder, from the manifest the shots step writes. */
export function pagesIn(slug: string, dir: string): PageShots[] {
  const manifest = join(dir, 'pages.json');
  let routes: { path: string; file: string }[] = [];
  if (existsSync(manifest)) {
    try { routes = JSON.parse(readFileSync(manifest, 'utf8')); } catch { routes = []; }
  } else if (existsSync(dir)) {
    routes = [...new Set(readdirSync(dir).filter((f) => f.endsWith('-mobile.png')).map((f) => f.replace(/-mobile\.png$/, '')))].map((f) => ({ path: f === 'home' ? '/' : `/${f.replace(/-/g, '/')}`, file: f }));
  }
  return routes.map((r) => {
    const shots: Partial<Record<Device, string>> = {};
    for (const dv of DEVICES) { const u = fileUrl('site', slug, join(dir, `${r.file}-${dv}.png`)); if (u) shots[dv] = u; }
    return { path: r.path, label: pageLabel(r.path), shots };
  }).filter((p) => Object.keys(p.shots).length > 0);
}
export const pageShots = (slug: string) => pagesIn(slug, join(siteDir(slug), 'acta', 'qa', 'pages'));

export function roundsOf(slug: string): { round: number; takenAt: string; pages: PageShots[] }[] {
  const base = join(siteDir(slug), 'acta', 'qa', 'rounds');
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b).map((n) => {
    const dir = join(base, String(n));
    let takenAt = statSync(dir).mtime.toISOString();
    try { takenAt = JSON.parse(readFileSync(join(dir, 'taken.json'), 'utf8')).takenAt ?? takenAt; } catch { /* mtime */ }
    return { round: n, takenAt, pages: pagesIn(slug, dir) };
  });
}

// ---------- what the agent has written ----------

const has = (p: string, re?: RegExp) => { if (!existsSync(p)) return false; if (!re) return true; try { return re.test(readFileSync(p, 'utf8')); } catch { return false; } };

/** Read the agent's progress from the files the build skill leaves in acta/, in the skill's own phase order. */
export function agentProgress(dir: string): AgentProgress | null {
  if (!existsSync(join(dir, 'acta'))) return null;
  const compDir = join(dir, 'src', 'components');
  const phases = [
    { key: 'research', label: 'Research notes', done: has(join(dir, 'acta/research/board.md'), /^##\s+Designer notes/m) },
    { key: 'plan', label: 'Plan and photo audit', done: has(join(dir, 'acta/plan.md'), /^##\s+Photo audit/m) },
    { key: 'concepts', label: 'Three concepts', done: has(join(dir, 'acta/concepts.md'), /^##\s+Chosen/m) },
    { key: 'brief', label: 'Brief and theme', done: has(join(dir, 'acta/brief.md')) },
    { key: 'copy', label: 'Copy', done: existsSync(join(dir, 'src/content/site.ts')) && !has(join(dir, 'src/content/site.ts'), /TODO copywriter/) },
    { key: 'pages', label: 'Pages and sections', done: existsSync(compDir) && readdirSync(compDir).some((f) => f.endsWith('.tsx')) },
    { key: 'qa', label: 'Checks pass', done: has(join(dir, 'acta/qa/gate.json'), /"pass":\s*true/) },
  ];
  // The phases are sequential; one finished out of order (for example a gate file left from an earlier run) doesn't skip the rest.
  const firstOpen = phases.findIndex((p) => !p.done);
  return { phases, current: firstOpen >= 0 ? phases[firstOpen].label : null, lastCommit: lastCommit(dir) };
}

const commitCache = new Map<string, { at: number; v: AgentProgress['lastCommit'] }>();
function lastCommit(dir: string): AgentProgress['lastCommit'] {
  const c = commitCache.get(dir);
  if (c && Date.now() - c.at < 5000) return c.v;
  let v: AgentProgress['lastCommit'] = null;
  if (existsSync(join(dir, '.git'))) {
    const r = spawnSync('git', ['log', '-1', '--format=%s%x09%cI'], { cwd: dir, encoding: 'utf8', timeout: 3000 });
    const [message, at] = (r.stdout ?? '').trim().split('\t');
    if (message && at) v = { message, at: new Date(at).toISOString() };
  }
  commitCache.set(dir, { at: Date.now(), v });
  return v;
}

const DOCS: [string, string][] = [['Plan', 'acta/plan.md'], ['Concepts', 'acta/concepts.md'], ['Brief', 'acta/brief.md'], ['Research', 'acta/research/board.md'], ['Build log', 'acta/build-log.md'], ['Review notes', 'acta/review-notes.md']];
export function docsOf(slug: string, dir: string): { name: string; url: string; updatedAt: string }[] {
  return DOCS.flatMap(([name, rel]) => {
    const p = join(dir, rel);
    const url = fileUrl('site', slug, p);
    return url ? [{ name, url, updatedAt: statSync(p).mtime.toISOString() }] : [];
  });
}

export const TAB_FOR_KIND: Record<string, BusinessTab> = { failed: 'progress', photos: 'photos', concept: 'concepts', review: 'review', send: 'deliver', reply: 'overview' };
