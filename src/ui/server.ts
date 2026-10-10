/**
 * The local UI server: the JSON API, live job logs, site files and the built browser app, on 127.0.0.1 only.
 * Every action is a pipeline function or a `pnpm pipeline` job, so the UI never does anything the CLI can't.
 * Started by `pnpm pipeline ui` (or `pnpm ui`).
 */
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT, loadCategories } from '../config.js';
import { openDb } from '../db/index.js';
import { fullLeads, getFullLead, setStatus } from '../db/queries.js';
import type { PipelineStatus } from '../db/types.js';
import { applyStatus } from '../crm/status.js';
import { pickManual, recordCallOutcome, unpick } from '../pick/index.js';
import { approve } from '../build/index.js';
import { getBuild, listBuilds, recentEvents, setBuildState } from '../build/queries.js';
import { envInt } from '../config.js';
import {
  agentPick, chooseConcept, chosenConcept, conceptsWritten, DROP_REASONS, listPhotos, loadCheckpoints, parseConcepts, PATHS, readConceptsMd, readCuration, resetConcepts, saveCuration,
} from '../build/checkpoints.js';
import { generateDelivery, markSent, readDelivery, senderMissing, updateDelivery } from '../delivery/index.js';
import type { BoardColumn, BuildDetail, ConceptSet, Device, Finding, Job, Meta, PhotoSet, Suggestion, TimelineEntry } from './api-types.js';
import { suggestions } from '../pick/suggest.js';
import { setSweep, loadAutomation } from '../loop/automation.js';
import { autopilotStatus, loadAutopilotConfig, setAutopilot, startAutopilot } from '../loop/autopilot.js';
import { jobInstalled } from '../loop/schedule.js';
import { sweepStates } from '../sweep/index.js';
import { loadSweep } from '../sweep/config.js';
import { planSweep } from '../sweep/plan.js';
import { observations } from '../sweep/queries.js';
import { leagues } from '../sweep/opportunity.js';
import { contentType, fileUrl, resolveFile } from './files.js';
import { activeJobFor, cancelJob, enqueue, getJob, jobArgs, jobRow, listJobs, onJobDone, readLog, recoverAndRun, cleanLine } from './jobs.js';
import { addFeedback, deleteFeedback, listFeedback, prepareRound, sentRounds, unsentCount, updateFeedback } from './feedback.js';
import { agentProgress, categoryLabel, docsOf, pageShots, roundsOf, siteDir, toBuildSummary, toContent, toLeadDetail, toLeadSummary, toReach , gradeOf } from './mappers.js';
import { board, movesFor, summary, columnFor } from './summary.js';
import { getUsage, overLimit } from './usage-cache.js';
import { dnsChecks, doFollowUp, followUpFor, logContact, onStatusChange, OutreachError, outreachStatus, pitchBlockers, sendPitch, undoPitch } from '../outreach/index.js';
import { messagesFor, type MessageRow } from '../outreach/store.js';
import { checkReplies } from '../outreach/replies.js';
import { startOutreachTicker } from '../outreach/tick.js';
import { opensConfigured, opensFor } from '../outreach/opens.js';
import { outreachStats } from '../outreach/stats.js';
import type { OutreachMessage } from './api-types.js';


/** Automatic lead finding: whether it's on, what the next run would search, and where the good leads have come from. */
function finding(): Finding {
  const cfg = loadSweep();
  const states = sweepStates(cfg);
  const plan = planSweep(states, cfg);
  const { trades, areas } = leagues(observations());
  const enough = <T extends { found: number }>(l: T[]) => l.filter((x) => x.found >= 10).slice(0, 5);
  const auto = loadAutomation();
  const viaAutopilot = auto.autopilot && jobInstalled('ui');   // the always-on server runs the daily search itself
  return {
    on: auto.sweep, scheduled: jobInstalled('leads') || viaAutopilot, runsAt: auto.autopilot ? `${loadAutopilotConfig().leads_at} daily (autopilot)` : '07:30 daily', budget: cfg.budget, possible: states.length,
    next: plan.run.map((r) => ({ query: r.query, per10: Math.round((r.rate ?? 0) * 100) / 10, fresh: r.runs === 0, why: r.why ?? [] })),
    bestTrades: enough(trades).map((t) => ({ label: categoryLabel(t.key), per10: t.per10, found: t.found })),
    bestAreas: enough(areas).map((a) => ({ label: a.key, per10: a.per10, found: a.found })),
  };
}

export const PORT = Number(process.env.ACTA_UI_PORT ?? 4321);
const UI_DIST = join(ROOT, 'ui', 'dist');
const d = () => openDb();

class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
const fail = (status: number, message: string, code?: string): never => { throw new HttpError(status, message, code); };

// ---------- helpers ----------

function leadOr404(slug: string) { return getFullLead(slug) ?? fail(404, `No business "${slug}"`); }
function buildOr404(slug: string) { const full = leadOr404(slug); return { full, build: getBuild(full.lead.id) ?? fail(404, `${full.lead.name} has no build yet`) }; }
const dirOf = (slug: string) => getBuild(leadOr404(slug).lead.id)?.repo_dir ?? siteDir(slug);

function buildSummaryFor(slug: string) {
  const full = getFullLead(slug); if (!full) return null;
  const b = getBuild(full.lead.id); if (!b) return null;
  return toBuildSummary({ ...b, slug, name: full.lead.name }, activeJobFor(slug), sentRounds(slug));
}

/** Refuse an agent run when usage is over the limit, unless overridden. */
async function usageGuard(override: unknown) {
  if (override === true) return;
  const over = overLimit(await getUsage({ wait: true }));
  if (over) fail(409, `Claude usage is over the limit: ${over}. Agent runs stop at the threshold so the rest of the week stays usable.`, 'usage');
}
function noActiveJob(slug: string) {
  const id = activeJobFor(slug);
  if (id !== null) fail(409, `A job is already running for this business (job ${id}). Wait for it or cancel it in Activity.`);
}
function startBuildJob(slug: string, name: string, opts: { force?: boolean; from?: string; kind?: 'build' | 'concepts'; label?: string } = {}): Job {
  noActiveJob(slug);
  const kind = opts.kind ?? 'build';
  return enqueue(kind, slug, opts.label ?? `${opts.force ? 'Rebuild' : 'Build'} ${name}`, jobArgs(kind, slug, { force: opts.force, from: opts.from }));
}
const body = async <T>(c: Context): Promise<T> => { try { return (await c.req.json()) as T; } catch { return {} as T; } };
const STEPS = ['gather', 'repo', 'research', 'agent', 'gate', 'push', 'deploy', 'evidence'];

function extraTimeline(slug: string, leadId: number): TimelineEntry[] {
  const jobs: TimelineEntry[] = (d().prepare('SELECT label, status, created_at, ended_at FROM jobs WHERE target = ? ORDER BY id DESC LIMIT 30').all(slug) as { label: string; status: string; created_at: string; ended_at: string | null }[])
    .map((j) => ({ at: j.ended_at ?? j.created_at, kind: 'job', text: `${j.label}: ${j.status === 'done' ? 'finished' : j.status}`, level: j.status === 'failed' ? 'error' : 'info' }));
  const rounds: TimelineEntry[] = (d().prepare('SELECT round, COUNT(*) n, MIN(created_at) at FROM feedback WHERE slug = ? AND round IS NOT NULL GROUP BY round').all(slug) as { round: number; n: number; at: string }[])
    .map((r) => ({ at: r.at, kind: 'review', text: `Review round ${r.round} sent with ${r.n} comment${r.n === 1 ? '' : 's'}` }));
  const events: TimelineEntry[] = recentEvents(leadId, 300).filter((e) => e.level !== 'info' || /^(paused:|live at|starting at)/.test(e.message))
    .map((e) => ({ at: e.at, kind: 'build', text: `${e.step ? `${e.step}: ` : ''}${e.message}`.slice(0, 240), level: e.level as TimelineEntry['level'] }));
  return [...jobs, ...rounds, ...events];
}

function gatesOf(dir: string): BuildDetail['gates'] {
  try {
    const g = JSON.parse(readFileSync(join(dir, 'acta', 'qa', 'gate.json'), 'utf8')) as { gates: { name: string; pass: boolean; value?: unknown; threshold?: unknown; details?: string[] }[] };
    return g.gates.map((x) => ({ name: x.name, pass: x.pass, value: (typeof x.value === 'number' || typeof x.value === 'string' ? x.value : x.value == null ? null : JSON.stringify(x.value)) as string | number | null, threshold: x.threshold == null ? null : String(x.threshold), details: x.details }));
  } catch { return null; }
}

/** Once the agent's work is done, nothing is "in progress", even for builds made before every phase left a file. */
function finishedAgent(p: ReturnType<typeof agentProgress>, state: string) {
  if (!p) return p;
  return ['built', 'gated', 'pushed', 'deployed', 'preview_ready', 'approved', 'live', 'torn_down'].includes(state) ? { ...p, current: null } : p;
}

function toMessage(m: MessageRow): OutreachMessage {
  return { id: m.id, direction: m.direction, kind: m.kind as OutreachMessage['kind'], channel: m.channel, to: m.to_addr, from: m.from_addr, subject: m.subject, body: m.body,
    transport: m.transport as OutreachMessage['transport'], status: m.status as OutreachMessage['status'], error: m.error, at: m.at };
}

// ---------- the app ----------

export function createApp() {
  const app = new Hono();

  // Only this machine, only this app. Blocks DNS rebinding (Host) and other websites posting here (Origin).
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return c.json({ error: 'Forbidden host' }, 403);
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return c.json({ error: 'Forbidden origin' }, 403);
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message, code: e.code }, e.status as 400);
    if (e instanceof OutreachError) return c.json({ error: e.message, code: e.code }, e.code === 'failed' ? 502 : 409);
    console.error(e);
    return c.json({ error: (e as Error).message || 'Server error' }, 500);
  });

  // ---- meta, usage, summary, board ----
  app.get('/api/meta', (c) => {
    const areas = (d().prepare('SELECT area, COUNT(*) n FROM leads GROUP BY area ORDER BY n DESC').all() as { area: string }[]).map((r) => r.area);
    const meta: Meta = { categories: loadCategories().map((x) => ({ key: x.key, label: x.key.replace(/_/g, ' ').replace(/^\w/, (s) => s.toUpperCase()) })), areas, senderMissing: senderMissing(), checkpoints: loadCheckpoints() };
    return c.json(meta);
  });
  app.get('/api/usage', async (c) => c.json(await getUsage()));
  app.get('/api/summary', async (c) => c.json(await summary()));
  app.get('/api/board', (c) => c.json(board()));
  app.post('/api/board/move', async (c) => {
    const b = await body<{ slug: string; to: BoardColumn; override?: boolean; note?: string }>(c);
    const full = leadOr404(String(b.slug));
    const build = getBuild(full.lead.id);
    const from = columnFor(full.pipeline.status as PipelineStatus, build?.state ?? null);
    if (!movesFor(from, build?.state ?? null).includes(b.to)) fail(409, `Can't move from ${from} to ${b.to}`);
    const slug = full.lead.slug;
    switch (b.to) {
      case 'building': await usageGuard(b.override); return c.json({ ok: true, message: `Build queued for ${full.lead.name}`, job: startBuildJob(slug, full.lead.name) });
      case 'ready': {
        const msg = approve(slug);
        if (getBuild(full.lead.id)?.state !== 'approved') fail(409, msg);
        try { generateDelivery(slug); } catch { /* the composer can generate it */ }
        return c.json({ ok: true, message: msg });
      }
      case 'preview': setBuildState(full.lead.id, 'preview_ready'); setStatus(slug, 'preview_ready', 'approval undone'); return c.json({ ok: true, message: `${full.lead.name} back in preview` });
      case 'sent':
        if (from === 'ready') fail(409, 'Send the pitch from the composer so the message and channel are recorded');
        setStatus(slug, 'contacted', 'moved back to sent'); return c.json({ ok: true, message: `${full.lead.name}: sent` });
      case 'replied': setStatus(slug, 'replied', b.note); onStatusChange(slug, 'replied'); return c.json({ ok: true, message: `${full.lead.name}: replied` });
      case 'won': setStatus(slug, 'won', b.note); onStatusChange(slug, 'won'); return c.json({ ok: true, message: `${full.lead.name}: won` });
      case 'closed': { const r = applyStatus(slug, 'lost', b.note ?? 'closed from the board'); onStatusChange(slug, 'lost'); return c.json(r); }
      default: return fail(400, `Unknown column ${b.to}`);
    }
  });

  // ---- leads ----
  app.get('/api/leads', (c) => {
    const q = c.req.query();
    const tiers = q.tier ? q.tier.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) : undefined;
    const statuses = q.status ? (q.status.split(',') as PipelineStatus[]) : undefined;
    const text = (q.q ?? '').trim().toLowerCase();
    const builds = new Map(listBuilds().map((b) => [b.slug, b.state]));
    const rows = fullLeads({ tiers, statuses })
      .filter((f) => !q.reach || q.reach.split(',').includes(toReach(f).level))
      .filter((f) => !q.verdict || q.verdict.split(',').includes(gradeOf(f).verdict))
      .filter((f) => { if (!q.email) return true; const r = toReach(f); return q.email === 'has' ? !!r.email : q.email === 'cold' ? r.emailAllowed : q.email === 'none' ? !r.email : true; })
      .filter((f) => (!q.category || f.lead.category_key === q.category) && (!q.area || f.lead.area === q.area)
        && (!text || `${f.lead.name} ${f.lead.area} ${f.lead.category_key} ${f.lead.address ?? ''}`.toLowerCase().includes(text)))
      .sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))
      .slice(0, 2000)
      .map((f) => toLeadSummary(f, builds.get(f.lead.slug) ?? null));
    return c.json(rows);
  });
  app.get('/api/leads/:slug', (c) => {
    const full = leadOr404(c.req.param('slug'));
    const build = buildSummaryFor(full.lead.slug);
    const sent = !!readDelivery(full.lead.slug)?.sentAt;
    return c.json(toLeadDetail(full, build, extraTimeline(full.lead.slug, full.lead.id), sent));
  });
  app.post('/api/leads/:slug/pick', (c) => { const r = pickManual([leadOr404(c.req.param('slug')).lead.slug]); return c.json({ ok: r.ok.length > 0, message: r.ok.length ? 'Picked' : 'Not found' }); });
  app.post('/api/leads/:slug/unpick', (c) => { const msg = unpick(leadOr404(c.req.param('slug')).lead.slug); return c.json({ ok: /back to new/.test(msg), message: msg }); });
  app.post('/api/leads/:slug/call', async (c) => {
    const b = await body<{ answer?: string; note?: string }>(c);
    const slug = leadOr404(c.req.param('slug')).lead.slug;
    if (b.answer !== 'yes' && b.answer !== 'no') fail(400, 'answer must be yes or no');
    const msg = recordCallOutcome(slug, b.answer as 'yes' | 'no', b.note?.trim() || null);
    return c.json({ ok: /: (yes|no)\./.test(msg), message: msg });
  });
  app.post('/api/leads/:slug/contact', async (c) => {
    const b = await body<{ email?: string | null }>(c);
    const full = leadOr404(c.req.param('slug'));
    const email = (b.email ?? '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, 'That doesn\'t look like an email address');
    d().prepare('UPDATE leads SET manual_email = ? WHERE id = ?').run(email || null, full.lead.id);
    const fresh = getFullLead(full.lead.slug)!;
    const del = readDelivery(full.lead.slug);
    if (del && !del.sentAt) updateDelivery(full.lead.slug, { to: email || toReach(fresh).email || '' });
    return c.json({ ok: true, message: email ? `Saved ${email} for ${full.lead.name}` : 'Email removed', reach: toReach(fresh) });
  });

  app.post('/api/leads/:slug/web-email', (c) => {
    const full = leadOr404(c.req.param('slug'));
    const existing = d().prepare("SELECT id FROM jobs WHERE target = ? AND kind = 'email' AND status IN ('queued','running') LIMIT 1").get(full.lead.slug) as { id: number } | undefined;
    if (existing) return c.json(getJob(existing.id));
    return c.json(enqueue('email', full.lead.slug, `Find an email for ${full.lead.name}`, jobArgs('email', full.lead.slug)));
  });

  app.post('/api/leads/:slug/status', async (c) => {
    const b = await body<{ status: string; note?: string }>(c);
    const slug = leadOr404(c.req.param('slug')).lead.slug;
    const r = applyStatus(slug, String(b.status), b.note);
    if (r.ok) onStatusChange(slug, String(b.status));
    return c.json(r);
  });

  // ---- outreach ----
  app.get('/api/outreach', async (c) => c.json(await outreachStatus()));
  app.post('/api/outreach/dns', async (c) => { await dnsChecks(undefined, true); return c.json(await outreachStatus()); });
  app.post('/api/outreach/replies', async (c) => c.json(await checkReplies()));
  app.get('/api/outreach/stats', (c) => c.json(outreachStats()));
  app.get('/api/leads/:slug/outreach', (c) => {
    const full = leadOr404(c.req.param('slug'));
    return c.json({ messages: messagesFor(full.lead.id).map(toMessage), followUp: followUpFor(full), nextTouchAt: full.pipeline.next_touch_at ?? null, pitchBlockers: pitchBlockers(full.lead.slug),
      opens: opensFor(full.lead.id), opensTracked: opensConfigured() });
  });
  app.post('/api/leads/:slug/followup', async (c) => {
    const b = await body<{ mode?: 'send' | 'logged'; subject?: string; body?: string; channel?: string; override?: boolean }>(c);
    const full = leadOr404(c.req.param('slug'));
    const m = await doFollowUp(full.lead.slug, { mode: b.mode === 'send' ? 'send' : 'logged', subject: b.subject, body: b.body, channel: b.channel, override: b.override });
    return c.json({ ok: true, message: m.status === 'logged' ? 'Follow-up recorded' : m.status === 'written' ? 'Follow-up written to out/outbox (test mode)' : 'Follow-up sent', sent: toMessage(m) });
  });

  // ---- builds ----
  app.get('/api/builds', (c) => c.json(listBuilds().map((b) => toBuildSummary(b, activeJobFor(b.slug), sentRounds(b.slug)))));
  app.get('/api/builds/:slug', (c) => {
    const { full, build } = buildOr404(c.req.param('slug'));
    const slug = full.lead.slug;
    const dir = build.repo_dir ?? siteDir(slug);
    const summary = toBuildSummary({ ...build, slug, name: full.lead.name }, activeJobFor(slug), sentRounds(slug));
    const active = summary.activeJobId !== null ? jobRow(summary.activeJobId) : undefined;
    const shotsJob = d().prepare("SELECT id FROM jobs WHERE target = ? AND kind = 'shots' AND status IN ('queued','running') LIMIT 1").get(slug);
    const del = readDelivery(slug);
    const detail: BuildDetail = {
      ...summary,
      events: recentEvents(full.lead.id, 300),
      gates: existsSync(dir) ? gatesOf(dir) : null,
      pages: pageShots(slug),
      docs: existsSync(dir) ? docsOf(slug, dir) : [],
      agent: existsSync(dir) ? finishedAgent(agentProgress(dir), build.state) : null,
      feedback: listFeedback(slug),
      delivery: del ? { slug, createdAt: del.createdAt, channel: del.channel, emailAllowed: del.emailAllowed, zipUrl: del.zipUrl, sentAt: del.sentAt, sentChannel: del.sentChannel } : null,
      maxMinutes: envInt('BUILD_MAX_MINUTES', 240),
      maxTurns: envInt('BUILD_MAX_TURNS', 400),
      startedAt: active?.started_at ?? active?.created_at ?? null,
      shotsTaking: !!shotsJob,
    };
    return c.json(detail);
  });
  app.post('/api/builds/:slug/start', async (c) => {
    const b = await body<{ force?: boolean; from?: string; override?: boolean }>(c);
    const full = leadOr404(c.req.param('slug'));
    if (b.from && !STEPS.includes(b.from)) fail(400, `Unknown step ${b.from}`);
    await usageGuard(b.override);
    if (full.pipeline.status === 'new') pickManual([full.lead.slug]);
    return c.json(startBuildJob(full.lead.slug, full.lead.name, { force: b.force, from: b.from }));
  });
  app.post('/api/builds/:slug/approve', (c) => {
    const { full } = buildOr404(c.req.param('slug'));
    const message = approve(full.lead.slug);
    const ok = getBuild(full.lead.id)?.state === 'approved';
    let delivery = null;
    if (ok) { try { const g = generateDelivery(full.lead.slug); delivery = { slug: g.slug, createdAt: g.createdAt, channel: g.channel, emailAllowed: g.emailAllowed, zipUrl: g.zipUrl, sentAt: g.sentAt, sentChannel: g.sentChannel }; } catch { /* generate later */ } }
    return c.json({ ok, message, delivery }, ok ? 200 : 409);
  });
  app.post('/api/builds/:slug/teardown', (c) => { const { full } = buildOr404(c.req.param('slug')); noActiveJob(full.lead.slug); return c.json(enqueue('teardown', full.lead.slug, `Tear down ${full.lead.name}`, jobArgs('teardown', full.lead.slug))); });
  app.post('/api/builds/:slug/deploy', (c) => { const { full } = buildOr404(c.req.param('slug')); noActiveJob(full.lead.slug); return c.json(enqueue('deploy', full.lead.slug, `Deploy ${full.lead.name}`, jobArgs('deploy', full.lead.slug))); });
  app.post('/api/builds/:slug/shots', (c) => {
    const { full } = buildOr404(c.req.param('slug'));
    const existing = d().prepare("SELECT id FROM jobs WHERE target = ? AND kind = 'shots' AND status IN ('queued','running') LIMIT 1").get(full.lead.slug) as { id: number } | undefined;
    if (existing) return c.json(getJob(existing.id));
    return c.json(enqueue('shots', full.lead.slug, `Screenshots of ${full.lead.name}`, jobArgs('shots', full.lead.slug)));
  });

  // ---- review comments and rounds ----
  app.post('/api/builds/:slug/feedback', async (c) => { const { full } = buildOr404(c.req.param('slug')); return c.json(addFeedback(full.lead.slug, await body(c))); });
  app.patch('/api/feedback/:id', async (c) => { const r = updateFeedback(Number(c.req.param('id')), await body(c)); return r ? c.json(r) : fail(404, 'No such comment'); });
  app.delete('/api/feedback/:id', (c) => (deleteFeedback(Number(c.req.param('id'))) ? c.json({ ok: true }) : fail(404, 'No unsent comment with that id')));
  app.post('/api/builds/:slug/feedback/send', async (c) => {
    const b = await body<{ override?: boolean }>(c);
    const { full, build } = buildOr404(c.req.param('slug'));
    if (!['preview_ready', 'approved', 'failed'].includes(build.state)) fail(409, `The build is ${build.state}; comments can be sent once a preview is ready`);
    if (!unsentCount(full.lead.slug)) fail(409, 'There are no unsent comments');
    noActiveJob(full.lead.slug);
    await usageGuard(b.override);
    const r = await prepareRound(full.lead.slug, full.lead.name);
    return c.json(enqueue('revise', full.lead.slug, `Revise ${full.lead.name}, round ${r.round}`, jobArgs('revise', full.lead.slug, { note: r.note })));
  });
  app.get('/api/builds/:slug/rounds', (c) => c.json(roundsOf(leadOr404(c.req.param('slug')).lead.slug)));

  // ---- photo checkpoint ----
  app.get('/api/builds/:slug/photos', (c) => {
    const { full, build } = buildOr404(c.req.param('slug'));
    const slug = full.lead.slug;
    const dir = build.repo_dir ?? siteDir(slug);
    if (!existsSync(join(dir, 'acta', 'brand.json'))) return c.json({ photos: [], waiting: false, curated: false, reasons: DROP_REASONS, dropStats: [] } satisfies PhotoSet);
    const cur = readCuration(dir);
    const choiceOf = (p: string): PhotoSet['photos'][number]['choice'] => (cur ? (cur.hero === p ? 'hero' : cur.drop.some((x) => x.path === p) ? 'drop' : cur.keep.includes(p) ? 'keep' : null) : null);
    const photos = listPhotos(dir).map((p) => ({
      path: p.path,
      url: fileUrl('site', slug, join(dir, p.dropped ? join(PATHS.dropped, p.path.split('/').pop()!) : p.path)) ?? '',
      source: p.source, width: p.width, height: p.height, alt: p.alt, choice: choiceOf(p.path), reason: cur?.drop.find((x) => x.path === p.path)?.reason ?? null,
    })).filter((p) => p.url);
    const dropStats = d().prepare("SELECT reason, COUNT(*) count FROM photo_verdicts WHERE choice = 'drop' AND reason IS NOT NULL GROUP BY reason ORDER BY count DESC").all() as { reason: string; count: number }[];
    return c.json({ photos, waiting: build.state === 'awaiting_photos', curated: !!cur && !cur.skipped, reasons: DROP_REASONS, dropStats } satisfies PhotoSet);
  });
  app.put('/api/builds/:slug/photos', async (c) => {
    const b = await body<{ choices: { path: string; choice: 'keep' | 'drop' | 'hero'; reason?: string | null }[]; resume?: boolean; override?: boolean }>(c);
    const { full, build } = buildOr404(c.req.param('slug'));
    const slug = full.lead.slug;
    const dir = build.repo_dir ?? siteDir(slug);
    const known = new Set(listPhotos(dir).map((p) => p.path));
    const choices = (b.choices ?? []).filter((x) => known.has(x.path) && ['keep', 'drop', 'hero'].includes(x.choice));
    const waiting = build.state === 'awaiting_photos';
    if (waiting && b.resume) { noActiveJob(slug); await usageGuard(b.override); }
    if (waiting && choices.filter((x) => x.choice !== 'drop').length === 0) fail(400, 'Keep at least one photo, or skip and use the automatic choice');
    await saveCuration(dir, choices, { apply: waiting });
    const ins = d().prepare('INSERT INTO photo_verdicts (slug, path, choice, reason, at) VALUES (?,?,?,?,?) ON CONFLICT(slug, path) DO UPDATE SET choice = excluded.choice, reason = excluded.reason, at = excluded.at');
    for (const x of choices) ins.run(slug, x.path, x.choice, x.choice === 'drop' ? (x.reason ?? null) : null, new Date().toISOString());
    const job = waiting && b.resume ? startBuildJob(slug, full.lead.name, { label: `Continue ${full.lead.name} after photos` }) : null;
    return c.json({ ok: true, message: waiting ? `Photos saved${job ? '; the build continues' : ''}` : 'Saved. The choices apply to the next build or revision.', job });
  });
  app.post('/api/builds/:slug/photos/skip', async (c) => {
    const b = await body<{ override?: boolean }>(c);
    const { full, build } = buildOr404(c.req.param('slug'));
    if (build.state !== 'awaiting_photos') fail(409, 'The build is not waiting for photos');
    noActiveJob(full.lead.slug);
    await usageGuard(b.override);
    const dir = build.repo_dir ?? siteDir(full.lead.slug);
    await saveCuration(dir, listPhotos(dir).filter((p) => !p.dropped).map((p) => ({ path: p.path, choice: 'keep' as const })), { apply: true, skipped: true });
    return c.json({ ok: true, message: 'Using the automatic photo choice; the build continues', job: startBuildJob(full.lead.slug, full.lead.name, { label: `Continue ${full.lead.name}` }) });
  });

  // ---- concept checkpoint ----
  app.get('/api/builds/:slug/concepts', (c) => {
    const { full, build } = buildOr404(c.req.param('slug'));
    const slug = full.lead.slug;
    const dir = build.repo_dir ?? siteDir(slug);
    const md = existsSync(dir) ? readConceptsMd(dir) : '';
    const concepts = parseConcepts(md).map((x) => {
      const shots: Partial<Record<Device, string>> = {};
      for (const dv of ['mobile', 'desktop'] as const) { const u = fileUrl('site', slug, join(dir, PATHS.conceptsDir, `concept-${x.index}-${dv}.png`)); if (u) shots[dv] = u; }
      return { ...x, shots };
    });
    const set: ConceptSet = { concepts, waiting: build.state === 'awaiting_concept', chosen: md ? chosenConcept(dir) : null, agentPick: md ? agentPick(md) : null, mdUrl: fileUrl('site', slug, join(dir, PATHS.concepts)) };
    return c.json(set);
  });
  app.post('/api/builds/:slug/concepts/choose', async (c) => {
    const b = await body<{ index: number | null; note?: string; override?: boolean }>(c);
    const { full, build } = buildOr404(c.req.param('slug'));
    const dir = build.repo_dir ?? siteDir(full.lead.slug);
    if (!conceptsWritten(dir)) fail(409, 'No concepts have been written yet');
    const waiting = build.state === 'awaiting_concept';
    if (waiting) { noActiveJob(full.lead.slug); await usageGuard(b.override); }
    const chosen = await chooseConcept(dir, b.index === null || b.index === undefined ? null : Number(b.index), b.note ?? null);
    const job = waiting ? startBuildJob(full.lead.slug, full.lead.name, { label: `Build ${full.lead.name} with concept ${chosen.index}` }) : null;
    return c.json({ ok: true, message: `Concept ${chosen.index}, ${chosen.name}, chosen${job ? '; the build continues' : ''}`, job });
  });
  app.post('/api/builds/:slug/concepts/regenerate', async (c) => {
    const b = await body<{ note?: string; override?: boolean }>(c);
    const { full, build } = buildOr404(c.req.param('slug'));
    if (build.state !== 'awaiting_concept') fail(409, 'New concepts can be requested while the build waits for a concept');
    if (!b.note?.trim()) fail(400, 'Say what was wrong with these concepts');
    noActiveJob(full.lead.slug);
    await usageGuard(b.override);
    await resetConcepts(build.repo_dir ?? siteDir(full.lead.slug), b.note!);
    return c.json(startBuildJob(full.lead.slug, full.lead.name, { kind: 'concepts', label: `New concepts for ${full.lead.name}` }));
  });

  // ---- discovery ----
  app.post('/api/search', async (c) => {
    const b = await body<{ query?: string }>(c);
    const query = String(b.query ?? '').trim().replace(/\s+/g, ' ');
    if (query.length < 3) fail(400, 'Type a search, for example "barbers in Moseley"');
    const running = d().prepare("SELECT id FROM jobs WHERE kind = 'search' AND target = ? AND status IN ('queued','running')").get(query) as { id: number } | undefined;
    if (running) return c.json(getJob(running.id));
    return c.json(enqueue('search', query, `Search "${query}"`, jobArgs('search', query)));
  });

  app.get('/api/suggestions', (c) => c.json(suggestions().map((x): Suggestion => {
    const full = getFullLead(x.slug)!;
    return { slug: x.slug, name: x.name, categoryLabel: x.categoryLabel, area: x.area, tier: x.tier, score: x.score, pickScore: x.pickScore,
      reasons: x.reasons, reach: toReach(full), content: toContent(full), hook: x.hook, isNew: x.isNew, discoveredAt: x.discoveredAt,
      qualify: { verdict: x.verdict, grade: x.grade, gates: x.gates, parts: x.parts } };
  })));
  app.get('/api/discovery', (c) => c.json(finding()));
  app.post('/api/discovery/auto', async (c) => {
    const b = await body<{ on?: boolean }>(c);
    if (typeof b.on !== 'boolean') fail(400, 'Say on: true or on: false');
    setSweep(b.on!);
    return c.json(finding());
  });
  app.post('/api/discovery/run', (c) => {
    const running = d().prepare("SELECT id FROM jobs WHERE kind = 'leads' AND status IN ('queued','running')").get() as { id: number } | undefined;
    if (running) return c.json(getJob(running.id));
    return c.json(enqueue('leads', null, 'Find new leads', jobArgs('leads', null)));
  });

  // ---- the autopilot ----
  app.get('/api/autopilot', async (c) => c.json(await autopilotStatus()));
  app.post('/api/autopilot', async (c) => {
    const b = await body<{ on?: boolean }>(c);
    if (typeof b.on !== 'boolean') fail(400, 'Say on: true or on: false');
    setAutopilot(b.on!);
    return c.json(await autopilotStatus());
  });

  // ---- jobs ----
  app.get('/api/jobs', (c) => c.json(listJobs(Math.min(500, Number(c.req.query('limit') ?? 100)))));
  app.get('/api/jobs/:id', (c) => c.json(getJob(Number(c.req.param('id'))) ?? fail(404, 'No such job')));
  app.post('/api/jobs/:id/cancel', (c) => c.json(cancelJob(Number(c.req.param('id'))) ?? fail(404, 'No such job')));
  app.get('/api/jobs/:id/log', (c) => {
    const id = Number(c.req.param('id'));
    if (!jobRow(id)) fail(404, 'No such job');
    return streamSSE(c, async (stream) => {
      let pos = 0; let rest = '';
      const pump = async () => {
        const path = jobRow(id)?.log_path;
        if (!path || !existsSync(path)) return;
        const size = statSync(path).size;
        if (size <= pos) return;
        const fd = openSync(path, 'r');
        const buf = Buffer.alloc(Math.min(size - pos, 2_000_000));
        readSync(fd, buf, 0, buf.length, pos); closeSync(fd);
        pos += buf.length;
        const parts = (rest + buf.toString('utf8')).split('\n');
        rest = parts.pop() ?? '';
        for (const l of parts) { const line = cleanLine(l); if (line.trim()) await stream.writeSSE({ data: line }); }
      };
      let alive = true;
      stream.onAbort(() => { alive = false; });
      while (alive) {
        await pump();
        const j = getJob(id);
        if (!j || ['done', 'failed', 'cancelled'].includes(j.status)) {
          await pump();
          if (rest.trim()) await stream.writeSSE({ data: cleanLine(rest) });
          await stream.writeSSE({ event: 'end', data: JSON.stringify(j) });
          break;
        }
        await stream.sleep(700);
      }
    });
  });
  app.get('/api/jobs/:id/text', (c) => c.text(readLog(jobRow(Number(c.req.param('id')))?.log_path ?? null).join('\n')));

  // ---- delivery ----
  app.get('/api/deliveries/:slug', (c) => c.json(readDelivery(leadOr404(c.req.param('slug')).lead.slug) ?? fail(404, 'No package yet')));
  app.post('/api/deliveries/:slug', (c) => c.json(generateDelivery(leadOr404(c.req.param('slug')).lead.slug)));
  app.put('/api/deliveries/:slug', async (c) => c.json(updateDelivery(leadOr404(c.req.param('slug')).lead.slug, await body(c))));
  app.post('/api/deliveries/:slug/sent', async (c) => {
    const b = await body<{ channel?: string }>(c);
    const full = leadOr404(c.req.param('slug'));
    const del = readDelivery(full.lead.slug) ?? fail(409, 'Generate the package first');
    const missing = senderMissing();
    if (missing.length) fail(409, `Fill in your sender details in config/offer.yaml first: ${missing.join(', ')}`);
    const channel = String(b.channel ?? del.channel);
    if (channel === 'email' && !del.emailAllowed) fail(409, 'Cold email is not allowed for this business; use another channel');
    markSent(full.lead.slug, channel);
    logContact(full.lead.slug, { kind: 'pitch', channel, subject: channel === 'email' ? del.subject : null, body: channel === 'email' ? del.body : channel === 'whatsapp' ? del.whatsapp : null, to: channel === 'email' ? del.to : null });
    d().prepare('UPDATE pipeline SET channel = ? WHERE lead_id = ?').run(channel, full.lead.id);
    return c.json({ ok: true, message: `${full.lead.name}: marked as sent by ${channel.replace('_', ' ')}. Follow-up reminders are scheduled.` });
  });
  app.post('/api/deliveries/:slug/send', async (c) => {
    const b = await body<{ override?: boolean }>(c);
    const full = leadOr404(c.req.param('slug'));
    const m = await sendPitch(full.lead.slug, { override: b.override });
    markSent(full.lead.slug, 'email');
    d().prepare('UPDATE pipeline SET channel = ? WHERE lead_id = ?').run('email', full.lead.id);
    return c.json({ ok: true, message: m.status === 'written' ? 'Test mode: the email was written to out/outbox, not sent.' : `Sent to ${m.to_addr}. Follow-up reminders are scheduled.`, sent: toMessage(m) });
  });
  app.post('/api/deliveries/:slug/unsent', (c) => {
    const full = leadOr404(c.req.param('slug'));
    markSent(full.lead.slug, null);
    undoPitch(full.lead.slug);
    setStatus(full.lead.slug, 'preview_ready', 'sending undone');
    return c.json({ ok: true, message: 'Sending undone' });
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // ---- files ----
  app.get('/files/:kind/:slug/*', (c) => {
    const { kind, slug } = c.req.param();
    const rest = c.req.path.split('/').slice(4).join('/');
    const abs = resolveFile(kind, slug, rest);
    if (!abs) return c.json({ error: 'Not found' }, 404);
    return new Response(readFileSync(abs), { headers: { 'content-type': contentType(abs), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } });
  });

  // ---- the built browser app, with client-side routing ----
  app.get('*', (c) => {
    if (!existsSync(join(UI_DIST, 'index.html'))) return c.text('The UI has not been built. Run `pnpm ui:build`, or `pnpm ui:dev` while developing.', 503);
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.[/\\])+/, '');
    const file = join(UI_DIST, rel);
    if (rel !== '/' && file.startsWith(UI_DIST) && existsSync(file) && statSync(file).isFile()) {
      const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
      return new Response(readFileSync(file), { headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' } });
    }
    return new Response(readFileSync(join(UI_DIST, 'index.html')), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
  });

  return app;
}

/** After a build or revision finishes with a preview, take fresh page screenshots for the review studio. */
function autoShots() {
  onJobDone((job) => {
    if (job.status !== 'done' || !job.target || !['build', 'revise', 'concepts', 'deploy'].includes(job.kind)) return;
    const full = getFullLead(job.target);
    const b = full ? getBuild(full.lead.id) : undefined;
    if (!full || !b || b.state !== 'preview_ready') return;
    enqueue('shots', full.lead.slug, `Screenshots of ${full.lead.name}`, jobArgs('shots', full.lead.slug));
  });
}

export function startServer(port = PORT): { close: () => void } {
  openDb();
  const timer = recoverAndRun();
  autoShots();
  startOutreachTicker();
  // The autopilot (src/loop/autopilot.ts): resumes builds paused at the usage limit, and when switched on runs the
  // timetabled jobs, picks and builds by itself, and notifies you when a site is ready or a build fails.
  const autopilot = startAutopilot();
  const server = serve({ fetch: createApp().fetch, port, hostname: '127.0.0.1' });
  console.log(`Acta UI on http://127.0.0.1:${port}${existsSync(join(UI_DIST, 'index.html')) ? '' : ' (API only: run `pnpm ui:build` for the app, or `pnpm ui:dev` and open http://localhost:5173)'}`);
  void getUsage();
  return { close: () => { clearInterval(timer); clearInterval(autopilot); server.close(); } };
}
