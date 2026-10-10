/**
 * Background jobs for the UI: each is `pnpm -s pipeline <args>` in its own process group, logging to
 * data/jobs/<id>.log. Heavy agent work runs one at a time; searches one at a time; quick jobs immediately.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT } from '../config.js';
import { openDb } from '../db/index.js';
import { isoNow } from '../util/dates.js';
import type { Job, JobKind, JobStatus } from './api-types.js';

export const JOBS_DIR = join(DATA_DIR, 'jobs');

interface JobRow { id: number; kind: JobKind; target: string | null; label: string; args_json: string; status: JobStatus; pid: number | null; log_path: string | null; created_at: string; started_at: string | null; ended_at: string | null; exit_code: number | null }

const d = () => openDb();

/** The pipeline CLI arguments for a job. */
export function jobArgs(kind: JobKind, target: string | null, opts: { force?: boolean; note?: string; from?: string } = {}): string[] {
  switch (kind) {
    case 'build': return ['build', target!, ...(opts.force ? ['--force'] : []), ...(opts.from ? ['--from', opts.from] : [])];
    case 'concepts': return ['build', target!];
    case 'revise': return ['reject', target!, '--note', opts.note ?? ''];
    case 'deploy': return ['build', target!, '--from', 'deploy'];
    case 'teardown': return ['teardown', target!, '--yes'];
    case 'search': return ['run', target!];
    case 'leads': return ['leads', '--once'];
    case 'gather': return ['gather', target!];
    case 'shots': return ['shots', target!];
    case 'email': return ['web-emails', target!];
    case 'day': return ['day'];
    case 'week': return ['week'];
  }
}

export const LANE: Record<JobKind, 'agent' | 'search' | 'quick'> = {
  build: 'agent', revise: 'agent', concepts: 'agent', deploy: 'agent', search: 'search', leads: 'search', week: 'search', gather: 'quick', teardown: 'quick', shots: 'quick', email: 'quick', day: 'quick',
};

/** Which queued jobs may start now, given what is running. One agent job and one search at a time; quick jobs always. */
export function startable(queued: { id: number; kind: JobKind }[], running: { kind: JobKind }[]): number[] {
  const busy = new Set(running.map((r) => LANE[r.kind]));
  const out: number[] = [];
  for (const q of [...queued].sort((a, b) => a.id - b.id)) {
    const lane = LANE[q.kind];
    if (lane === 'quick') { out.push(q.id); continue; }
    if (busy.has(lane)) continue;
    busy.add(lane);
    out.push(q.id);
  }
  return out;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007|\r/g;
export const cleanLine = (l: string) => l.replace(ANSI, '').replace(/\[2K|\[1A|\[G/g, '').trimEnd();

export function readLog(path: string | null): string[] {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map(cleanLine).filter((l) => l.trim().length > 0);
}

function toJob(r: JobRow): Job {
  const lines = readLog(r.log_path);
  return {
    id: r.id, kind: r.kind, target: r.target, label: r.label, status: r.status,
    createdAt: r.created_at, startedAt: r.started_at, endedAt: r.ended_at, exitCode: r.exit_code,
    lastLine: lines.length ? lines[lines.length - 1].slice(0, 300) : null,
  };
}

export function getJob(id: number): Job | null {
  const r = d().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow | undefined;
  return r ? toJob(r) : null;
}
export function jobRow(id: number): JobRow | undefined {
  return d().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow | undefined;
}
export function listJobs(limit = 50): Job[] {
  return (d().prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as unknown as JobRow[]).map(toJob);
}
export function activeJobs(): Job[] {
  return (d().prepare("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY id").all() as unknown as JobRow[]).map(toJob);
}
/** The queued or running job for a slug, if any. */
export function activeJobFor(slug: string): number | null {
  const r = d().prepare("SELECT id FROM jobs WHERE target = ? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1").get(slug) as { id: number } | undefined;
  return r?.id ?? null;
}

export function enqueue(kind: JobKind, target: string | null, label: string, args: string[]): Job {
  mkdirSync(JOBS_DIR, { recursive: true });
  const res = d().prepare('INSERT INTO jobs (kind, target, label, args_json, status, created_at) VALUES (?,?,?,?,?,?)').run(kind, target, label, JSON.stringify(args), 'queued', isoNow());
  const id = Number(res.lastInsertRowid);
  const log = join(JOBS_DIR, `${id}.log`);
  d().prepare('UPDATE jobs SET log_path = ? WHERE id = ?').run(log, id);
  appendFileSync(log, `queued: pnpm pipeline ${args.map((a) => (a.length > 80 ? `${a.slice(0, 77)}…` : a)).join(' ')}\n`);
  tick();
  return getJob(id)!;
}

const pidAlive = (pid: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

type DoneHook = (job: Job) => void;
const doneHooks: DoneHook[] = [];
export const onJobDone = (h: DoneHook) => { doneHooks.push(h); };

function finish(id: number, status: JobStatus, code: number | null, note?: string) {
  const r = jobRow(id);
  if (!r || ['done', 'failed', 'cancelled'].includes(r.status)) return;
  if (note && r.log_path) appendFileSync(r.log_path, `${note}\n`);
  d().prepare('UPDATE jobs SET status = ?, exit_code = ?, ended_at = ? WHERE id = ?').run(status, code, isoNow(), id);
  const job = getJob(id)!;
  for (const h of doneHooks) { try { h(job); } catch { /* ignore */ } }
  tick();
}

function start(id: number) {
  const r = jobRow(id)!;
  const args = JSON.parse(r.args_json) as string[];
  const fd = openSync(r.log_path!, 'a');
  const child = spawn('pnpm', ['-s', 'pipeline', ...args], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd], env: process.env });
  closeSync(fd);
  d().prepare("UPDATE jobs SET status = 'running', pid = ?, started_at = ? WHERE id = ?").run(child.pid ?? null, isoNow(), id);
  // A build takes an hour or more: keep the Mac from idle-sleeping while it runs (the lid still sleeps it).
  if (process.platform === 'darwin' && LANE[r.kind] === 'agent' && child.pid) {
    try { spawn('caffeinate', ['-i', '-w', String(child.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ }
  }
  child.on('exit', (code, signal) => {
    const cur = jobRow(id);
    if (cur?.status === 'cancelled') return;
    finish(id, code === 0 ? 'done' : 'failed', code, code === 0 ? 'finished' : `exited with ${code ?? signal}`);
  });
  child.on('error', (e) => finish(id, 'failed', null, `could not start: ${e.message}`));
  child.unref();
}

/** Start whatever may start; notice jobs whose process vanished (e.g. started before a server restart). */
export function tick() {
  const running = d().prepare("SELECT * FROM jobs WHERE status = 'running'").all() as unknown as JobRow[];
  for (const r of running) if (!pidAlive(r.pid) && !ownChildren.has(r.id)) finish(r.id, 'done', null, 'finished (exit code unknown: the server restarted during the job; check the log)');
  const still = d().prepare("SELECT id, kind FROM jobs WHERE status = 'running'").all() as unknown as { id: number; kind: JobKind }[];
  const queued = d().prepare("SELECT id, kind FROM jobs WHERE status = 'queued'").all() as unknown as { id: number; kind: JobKind }[];
  for (const id of startable(queued, still)) { ownChildren.add(id); start(id); }
}
const ownChildren = new Set<number>();

/** On server start: running jobs whose process is gone are lost. Then start the poll loop. */
export function recoverAndRun(): NodeJS.Timeout {
  const running = d().prepare("SELECT * FROM jobs WHERE status = 'running'").all() as unknown as JobRow[];
  for (const r of running) if (!pidAlive(r.pid)) finish(r.id, 'failed', null, 'server restarted, job lost');
  tick();
  return setInterval(tick, 2000);
}

export function cancelJob(id: number): Job | null {
  const r = jobRow(id);
  if (!r) return null;
  if (r.status === 'queued') {
    d().prepare("UPDATE jobs SET status = 'cancelled', ended_at = ? WHERE id = ?").run(isoNow(), id);
  } else if (r.status === 'running') {
    d().prepare("UPDATE jobs SET status = 'cancelled', ended_at = ? WHERE id = ?").run(isoNow(), id);
    if (r.pid) { try { process.kill(-r.pid, 'SIGTERM'); } catch { try { process.kill(r.pid, 'SIGTERM'); } catch { /* gone */ } } }
    if (r.log_path) appendFileSync(r.log_path, 'cancelled from the UI\n');
  }
  tick();
  return getJob(id);
}
