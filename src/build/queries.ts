import { openDb } from '../db/index.js';
import { isoNow } from '../util/dates.js';
import type { BuildState, Step } from './state.js';

export interface BuildRow {
  lead_id: number; state: BuildState; failed_step: Step | null; step_attempts: number; last_error: string | null;
  repo_dir: string | null; repo_url: string | null; seed_sha: string | null; head_sha: string | null;
  vercel_project: string | null; deployment_url: string | null; preview_url: string | null;
  brand_json_path: string | null; gate_json_path: string | null; evidence_path: string | null; agent_result_path: string | null;
  agent_turns: number | null; agent_seconds: number | null; agent_cost_usd: number | null; research_fallback: number | null;
  created_at: string; built_at: string | null; deployed_at: string | null; reviewed_at: string | null; review_note: string | null; torn_down_at: string | null; updated_at: string;
}

const d = () => openDb();

export function getBuild(leadId: number): BuildRow | undefined {
  return d().prepare('SELECT * FROM builds WHERE lead_id = ?').get(leadId) as unknown as BuildRow | undefined;
}

export function ensureBuild(leadId: number): BuildRow {
  const existing = getBuild(leadId);
  if (existing) return existing;
  const now = isoNow();
  d().prepare('INSERT INTO builds (lead_id, state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(leadId, 'picked', now, now);
  return getBuild(leadId)!;
}

export function updateBuild(leadId: number, patch: Partial<Omit<BuildRow, 'lead_id' | 'created_at'>>) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  d().prepare(`UPDATE builds SET ${sets}, updated_at = ? WHERE lead_id = ?`).run(...(entries.map(([, v]) => v) as never[]), isoNow() as never, leadId as never);
}

export function setBuildState(leadId: number, state: BuildState, extra: Partial<BuildRow> = {}) {
  updateBuild(leadId, { state, failed_step: null, last_error: null, step_attempts: 0, ...extra });
}

export function failBuild(leadId: number, step: Step, error: string, attempts: number) {
  updateBuild(leadId, { state: 'failed', failed_step: step, last_error: error.slice(0, 2000), step_attempts: attempts });
}

export function listBuilds(opts: { states?: BuildState[] } = {}): (BuildRow & { slug: string; name: string })[] {
  const where = opts.states?.length ? `WHERE b.state IN (${opts.states.map(() => '?').join(',')})` : '';
  return d().prepare(`SELECT b.*, l.slug, l.name FROM builds b JOIN leads l ON l.id = b.lead_id ${where} ORDER BY b.updated_at DESC`).all(...((opts.states ?? []) as never[])) as unknown as (BuildRow & { slug: string; name: string })[];
}

export function recentEvents(leadId: number, n = 20): { at: string; step: string | null; level: string; message: string }[] {
  return d().prepare('SELECT at, step, level, message FROM build_events WHERE lead_id = ? ORDER BY id DESC LIMIT ?').all(leadId, n).reverse() as unknown as { at: string; step: string | null; level: string; message: string }[];
}
