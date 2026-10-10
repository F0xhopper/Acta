/**
 * The autopilot: the pipeline running by itself while the Acta server is up. Every minute it looks at the state of
 * things and does the next obvious thing: carry on a build paused at the usage limit once usage is back under it,
 * run the timetabled chores (the daily lead search, weekday housekeeping, the Sunday re-score), and when nothing is
 * building, pick the best lead that passes every gate (src/pick) and build it. It stops starting builds at the Claude
 * usage limit, at the daily build limit, when builds keep failing, and while enough previews wait for your review.
 * You are told when a site is ready or a build fails (src/loop/notify.ts). Everything it starts is an ordinary job,
 * so Activity shows it all. The decision itself (`decide`) is pure, so it is tested without a database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';
import { openDb } from '../db/index.js';
import { getFullLead } from '../db/queries.js';
import { getBuild, listBuilds } from '../build/queries.js';
import { autoPick, pickedQueue } from '../pick/index.js';
import { activeJobFor, activeJobs, enqueue, jobArgs, LANE, onJobDone } from '../ui/jobs.js';
import { getUsage, overLimit } from '../ui/usage-cache.js';
import type { Autopilot as AutopilotStatus, Usage } from '../ui/api-types.js';
import { log } from '../util/log.js';
import { loadAutomation, setAutomation, type Automation } from './automation.js';
import { notify, pushConfigured } from './notify.js';
import { jobInstalled } from './schedule.js';

// ---------- config (config/build.yaml, `autopilot`) ----------

const HHMM = z.string().regex(/^\d\d:\d\d$/, 'a time like 07:30');
export const AutopilotSchema = z.object({
  max_builds_per_day: z.number().int().min(1).default(3),
  max_unreviewed: z.number().int().min(1).default(3),
  leads_at: HHMM.default('07:30'),
  day_at: HHMM.default('09:15'),
  week_at: HHMM.default('22:00'),
});
export type AutopilotConfig = z.infer<typeof AutopilotSchema>;

export function loadAutopilotConfig(): AutopilotConfig {
  try {
    const raw = parseYaml(readFileSync(join(ROOT, 'config', 'build.yaml'), 'utf8')) as { autopilot?: unknown };
    return AutopilotSchema.parse(raw.autopilot ?? {});
  } catch { return AutopilotSchema.parse({}); }
}

// ---------- the timetable ----------

export type Chore = 'leads' | 'day' | 'week';
const CHORES: { kind: Chore; days: number[]; at: (c: AutopilotConfig) => string; label: string }[] = [
  { kind: 'leads', days: [0, 1, 2, 3, 4, 5, 6], at: (c) => c.leads_at, label: 'Find new leads (daily run)' },
  { kind: 'day', days: [1, 2, 3, 4, 5], at: (c) => c.day_at, label: 'Weekday housekeeping' },
  { kind: 'week', days: [0], at: (c) => c.week_at, label: 'Sunday re-audit and re-score' },
];
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Whether `now` (local time) is at or past a time of day. Pure. */
export const pastTime = (now: Date, hhmm: string) => now.getHours() * 60 + now.getMinutes() >= minutesOf(hhmm);

/** The next timetabled run after `now`, skipping chores already run today. Pure. */
export function nextChore(now: Date, cfg: AutopilotConfig, doneToday: Set<Chore>, sweepOn = true): { kind: Chore; at: Date } | null {
  let best: { kind: Chore; at: Date } | null = null;
  for (const c of CHORES) {
    if (c.kind === 'leads' && !sweepOn) continue;
    const m = minutesOf(c.at(cfg));
    for (let d = 0; d < 8; d++) {
      const at = new Date(now);
      at.setDate(at.getDate() + d);
      at.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (!c.days.includes(at.getDay())) continue;
      if (d === 0 && (at <= now || doneToday.has(c.kind))) continue;
      if (!best || at < best.at) best = { kind: c.kind, at };
      break;
    }
  }
  return best;
}

// ---------- the decision ----------

export interface Snapshot {
  on: boolean;
  sweepOn: boolean;
  usageOver: string | null;     // the limit usage is over ("the session is at 72%"), or null
  agentBusy: boolean;           // a build, revision, concepts or deploy job is queued or running
  paused: string[];             // builds at awaiting_usage with no job
  unreviewed: number;           // previews waiting for your review
  buildsToday: number;          // businesses a build job was started for today
  failedToday: number;          // builds that failed today
  queue: string[];              // picked, not started, best first
  choresToday: Set<Chore>;
  now: Date;
}
export type Action =
  | { kind: 'resume'; slug: string }
  | { kind: 'chore'; chore: Chore }
  | { kind: 'build'; slug: string }
  | { kind: 'pick' }
  | { kind: 'idle'; reason: string };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export const OFF_REASON = 'Off. Builds you start still run, and paused ones still carry on when usage resets';

/** What to do now. Resumes and due chores first, then exactly one of: build the next picked lead, pick one, or idle with the reason. Pure. */
export function decide(s: Snapshot, cfg: AutopilotConfig): Action[] {
  const out: Action[] = [];
  // Paused builds carry on whether or not the autopilot is on: they were started on purpose.
  if (!s.usageOver) for (const slug of s.paused) out.push({ kind: 'resume', slug });
  const idle = (reason: string): Action[] => [...out, { kind: 'idle', reason }];
  if (!s.on) return idle(OFF_REASON);
  for (const c of CHORES) {
    if (c.kind === 'leads' && !s.sweepOn) continue;
    if (c.days.includes(s.now.getDay()) && pastTime(s.now, c.at(cfg)) && !s.choresToday.has(c.kind)) out.push({ kind: 'chore', chore: c.kind });
  }
  if (s.agentBusy) return idle('A build is running');
  if (s.usageOver) return idle(`Waiting for Claude usage to reset: ${s.usageOver}${s.paused.length ? `. ${plural(s.paused.length, 'paused build')} will carry on first` : ''}`);
  if (s.paused.length) return idle(`Carrying on ${plural(s.paused.length, 'build')} paused at the usage limit`);
  if (s.failedToday >= 2) return idle(`${plural(s.failedToday, 'build')} failed today. Check the Inbox before it tries another; it carries on tomorrow`);
  if (s.unreviewed >= cfg.max_unreviewed) return idle(`${plural(s.unreviewed, 'preview')} waiting for your review (it stops at ${cfg.max_unreviewed}). Review or close one and it carries on`);
  if (s.buildsToday >= cfg.max_builds_per_day) return idle(`${plural(s.buildsToday, 'build')} today, the daily limit. It carries on tomorrow`);
  if (s.queue.length) return [...out, { kind: 'build', slug: s.queue[0] }];
  return [...out, { kind: 'pick' }];
}

/** The reason a fresh decision gives, for a status read before the first tick (the CLI). Pure. */
export function reasonOf(actions: Action[]): string {
  const last = actions[actions.length - 1];
  if (!last || last.kind === 'idle') return last?.reason ?? 'Nothing to do';
  if (last.kind === 'build') return `Next: build ${last.slug} from the picked queue`;
  return 'Next: pick the best lead that passes every gate and build it';
}

// ---------- reading the state ----------

const d = () => openDb();
const dayStart = (now: Date) => { const t = new Date(now); t.setHours(0, 0, 0, 0); return t.toISOString(); };

export function snapshot(auto: Automation, usage: Usage | null, now = new Date()): Snapshot {
  const since = dayStart(now);
  const choresToday = new Set((d().prepare("SELECT DISTINCT kind FROM jobs WHERE kind IN ('leads','day','week') AND created_at >= ? AND status != 'cancelled'").all(since) as { kind: Chore }[]).map((r) => r.kind));
  const buildsToday = (d().prepare("SELECT COUNT(DISTINCT target) n FROM jobs WHERE kind IN ('build','concepts') AND created_at >= ? AND status != 'cancelled'").get(since) as { n: number }).n;
  return {
    on: auto.autopilot, sweepOn: auto.sweep, usageOver: overLimit(usage),
    agentBusy: activeJobs().some((j) => LANE[j.kind] === 'agent'),
    paused: listBuilds({ states: ['awaiting_usage'] }).filter((b) => activeJobFor(b.slug) === null).map((b) => b.slug),
    unreviewed: listBuilds({ states: ['preview_ready'] }).length,
    failedToday: listBuilds({ states: ['failed'] }).filter((b) => b.updated_at >= since).length,
    buildsToday,
    queue: pickedQueue().filter((q) => activeJobFor(q.slug) === null).map((q) => q.slug),
    choresToday, now,
  };
}

// ---------- running ----------

interface State { reason: string; tickedAt: string | null; announced: string | null; nextPickAt: number }
const state: State = { reason: 'Not started yet', tickedAt: null, announced: null, nextPickAt: 0 };
let busy = false;
const PICK_BACKOFF_MS = 30 * 60_000;   // grading every lead is not free: when nothing passes, look again in half an hour (or when a search finishes)
const UI = () => `http://127.0.0.1:${process.env.ACTA_UI_PORT ?? 4321}`;
const nameOf = (slug: string) => getFullLead(slug)?.lead.name ?? slug;
const when = (t: Date) => t.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function startBuild(slug: string, label: string) {
  if (activeJobFor(slug) !== null) return;
  enqueue('build', slug, label, jobArgs('build', slug));
  log.info(`autopilot: ${label}`);
}

async function pickAndBuild(snap: Snapshot, cfg: AutopilotConfig) {
  if (Date.now() < state.nextPickAt) return;   // the last look found nothing; the reason from then stands
  const r = await autoPick({ max: 1 });
  const c = r.picked[0];
  if (c) {
    state.nextPickAt = 0;
    startBuild(c.full.lead.slug, `Build ${c.full.lead.name} (autopilot pick, grade ${c.pickScore})`);
    state.reason = `Picked ${c.full.lead.name} (grade ${c.pickScore}) and started building it`;
    log.info(`autopilot: picked ${c.full.lead.slug}: ${c.reasons.slice(0, 3).join('; ')}`);
    return;
  }
  state.nextPickAt = Date.now() + PICK_BACKOFF_MS;
  const nc = nextChore(snap.now, cfg, snap.choresToday, snap.sweepOn);
  const held = r.skipped.filter((x) => /weekly cap|already /.test(x.why)).length;
  const dropped = r.rechecked.length ? ` ${plural(r.rechecked.length, 'lead')} dropped on re-check.` : '';
  state.reason = held
    ? `${plural(held, 'passer')} held back by the weekly caps in config/pick.yaml (diversity). Looks again in 30 minutes`
    : `No new lead passes every gate.${dropped} Looks again in 30 minutes${nc ? `; next ${nc.kind === 'leads' ? 'lead search' : nc.kind} ${when(nc.at)}` : ''}`;
}

/** Once per change: a notification when the autopilot is stuck on something only you can clear. */
function announce(snap: Snapshot, cfg: AutopilotConfig) {
  if (!snap.on) { state.announced = null; return; }
  const key = snap.failedToday >= 2 ? 'failed' : snap.unreviewed >= cfg.max_unreviewed ? 'review' : null;
  if (key === state.announced) return;
  state.announced = key;
  if (key === 'review') void notify('Acta is waiting for you', `${plural(snap.unreviewed, 'preview')} waiting for your review. Building carries on once you review or close one.`, { url: `${UI()}/` });
  if (key === 'failed') void notify('Acta paused', `${plural(snap.failedToday, 'build')} failed today. Check the Inbox before it tries another.`, { url: `${UI()}/` });
  // The usage pause is routine and the paused build carries on by itself: a log line, not a notification.
}

export async function autopilotTick(now = new Date()): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const auto = loadAutomation();
    const cfg = loadAutopilotConfig();
    const snap = snapshot(auto, await getUsage({ wait: true }), now);
    for (const a of decide(snap, cfg)) {
      if (a.kind === 'resume') startBuild(a.slug, `Continue ${nameOf(a.slug)} after the usage pause`);
      else if (a.kind === 'chore') { enqueue(a.chore, null, CHORES.find((c) => c.kind === a.chore)!.label, jobArgs(a.chore, null)); log.info(`autopilot: ${a.chore} run queued`); }
      else if (a.kind === 'build') { startBuild(a.slug, `Build ${nameOf(a.slug)} (autopilot, from the picked queue)`); state.reason = `Building ${nameOf(a.slug)} from the picked queue`; }
      else if (a.kind === 'pick') await pickAndBuild(snap, cfg);
      else state.reason = a.reason;
    }
    state.tickedAt = now.toISOString();
    announce(snap, cfg);
  } catch (e) {
    state.reason = `Stopped by an error: ${(e as Error).message.slice(0, 200)}`;
    log.warn(`autopilot: ${(e as Error).message}`);
  } finally { busy = false; }
}

/**
 * The switch. Writes the flag to config/build.yaml and acts on it now rather than at the next minute: on looks for
 * the next thing to do straight away (forgetting any "nothing passes" backoff); off stops it starting anything new.
 * A build already running is left alone: cancel it from Activity if you want it stopped.
 */
export function setAutopilot(on: boolean): void {
  setAutomation('autopilot', on);
  state.announced = null;
  if (on) {
    state.nextPickAt = 0;
    state.reason = 'Switched on. Looking for the next thing to do';
    void autopilotTick();
  } else {
    state.reason = OFF_REASON;
  }
  state.tickedAt ??= new Date().toISOString();
  log.info(`autopilot: switched ${on ? 'on' : 'off'}`);
}

/** When a build or revision ends: tell you if it's ready to review or it failed. New leads: look for a pick again now. */
function watchJobs() {
  onJobDone((job) => {
    if (job.kind === 'leads' || job.kind === 'search') state.nextPickAt = 0;
    if (!job.target || !['build', 'revise', 'concepts'].includes(job.kind)) return;
    const full = getFullLead(job.target);
    const b = full ? getBuild(full.lead.id) : undefined;
    if (!full || !b) return;
    const page = (tab: string) => `${UI()}/b/${encodeURIComponent(full.lead.slug)}/${tab}`;
    if (b.state === 'preview_ready') void notify('Site ready to review', `${full.lead.name}${b.preview_url ? `: ${b.preview_url}` : ''}`, { url: page('review') });
    else if (b.state === 'failed') void notify('Build failed', `${full.lead.name} stopped at ${b.failed_step ?? 'a step'}: ${(b.last_error ?? '').replace(/\s+/g, ' ').slice(0, 140)}`, { url: page('build') });
  });
}

/** Start the loop inside the UI server: a tick every minute, the first shortly after the server is up. */
export function startAutopilot(): NodeJS.Timeout {
  watchJobs();
  setTimeout(() => { void autopilotTick(); }, 15_000).unref();
  return setInterval(() => { void autopilotTick(); }, 60_000);
}

// ---------- status ----------

const lastAutoPick = () => (d().prepare("SELECT l.slug, l.name, p.picked_at at FROM picks p JOIN leads l ON l.id = p.lead_id WHERE p.picked_by = 'auto' ORDER BY p.picked_at DESC LIMIT 1").get() as { slug: string; name: string; at: string } | undefined) ?? null;

export async function autopilotStatus(now = new Date()): Promise<AutopilotStatus> {
  const auto = loadAutomation();
  const cfg = loadAutopilotConfig();
  const s = snapshot(auto, await getUsage({ wait: true }), now);
  const nc = nextChore(now, cfg, s.choresToday, s.sweepOn);
  return {
    on: s.on, scheduled: jobInstalled('ui'), reason: state.tickedAt ? state.reason : reasonOf(decide(s, cfg)),
    buildsToday: s.buildsToday, maxBuildsPerDay: cfg.max_builds_per_day, unreviewed: s.unreviewed, maxUnreviewed: cfg.max_unreviewed,
    queued: s.queue.length, usage: s.usageOver, nextChore: nc ? { kind: nc.kind, at: nc.at.toISOString() } : null, lastPick: lastAutoPick(), notifyPush: pushConfigured(),
  };
}

export function formatAutopilot(s: AutopilotStatus): string {
  return [
    `Autopilot: ${s.on ? 'on' : 'off'}${s.scheduled ? ' · always-on server installed (com.acta.ui)' : s.on ? ' · runs while `pnpm ui` is open; `pnpm pipeline schedule install` keeps it running whenever the Mac is on' : ''}`,
    `  ${s.reason}`,
    `  builds today ${s.buildsToday}/${s.maxBuildsPerDay} · previews waiting ${s.unreviewed}/${s.maxUnreviewed} · picked queue ${s.queued}${s.usage ? ` · ${s.usage}` : ''}`,
    s.nextChore ? `  next timetabled run: ${s.nextChore.kind} ${when(new Date(s.nextChore.at))}` : '',
    s.lastPick ? `  last pick: ${s.lastPick.name} (${s.lastPick.slug}), ${s.lastPick.at.slice(0, 16).replace('T', ' ')}` : '',
    `  notifications: macOS${s.notifyPush ? ' and a push to your phone (ACTA_NOTIFY_URL)' : '. Add ACTA_NOTIFY_URL to .env for a push to your phone as well'}`,
  ].filter(Boolean).join('\n');
}
