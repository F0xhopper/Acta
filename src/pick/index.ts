import { findCategory, loadScoring } from '../config.js';
import { auditLead } from '../audit/index.js';
import { closeBrowser } from '../audit/screenshot.js';
import { fullLeads, getFullLead, saveAudit, saveScore, setStatus } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import { scoreLead } from '../score/score.js';
import { ensureBuild, getBuild, updateBuild } from '../build/queries.js';
import { openDb } from '../db/index.js';
import { log } from '../util/log.js';
import { fetchWithTimeout } from '../util/http.js';
import { env } from '../config.js';
import { loadPick, type PickConfig } from './config.js';
import { gradeLead, missing } from './grade.js';
import { consentOf, outcomeStats, picksThisWeek, recordConsent, recordPick, removePick, type ConsentAnswer } from './queries.js';
import { applyDiversity, filterCandidates, type Candidate, type Skip } from './rules.js';
import { learning, tradeValue, type TradeLearning } from './trade.js';
import { needsCall } from './call.js';
import { loadCheckpoints } from '../build/checkpoints.js';
import { applyStatus } from '../crm/status.js';

export interface AutoPickResult {
  picked: Candidate[];
  skipped: Skip[];               // every lead considered and why it was not picked
  rechecked: { slug: string; before: string; after: string }[];
  overall: number | null;
  trades: TradeLearning;           // pitch outcomes by trade, which move trade values
  dryRun: boolean;
}

/** Before spending an hour of agent time, look at the site once more. A fixed site is a cooled lead. */
async function recheck(full: FullLead, cfg: PickConfig): Promise<{ full: FullLead; changed: string | null }> {
  // Is the Google listing still there? A vanished listing means a moved or merged business. One cheap id-only call.
  try {
    const res = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(full.lead.place_id)}`, { timeoutMs: 15000, headers: { 'x-goog-api-key': env('GOOGLE_PLACES_API_KEY'), 'x-goog-fieldmask': 'id' } });
    if (res.status === 404) { setStatus(full.lead.slug, 'lost', 'Google listing no longer exists'); return { full, changed: 'Google listing no longer exists, marked lost' }; }
  } catch { /* network blip: carry on with the site check */ }
  const before = full.audit?.website_status ?? 'none';
  if (before === 'none') return { full, changed: null };
  const audit = await auditLead(full.lead, { psi: false, screenshots: false });
  saveAudit(audit);
  const fresh = getFullLead(full.lead.slug)!;
  saveScore(scoreLead(fresh, loadScoring()));
  const after = getFullLead(full.lead.slug)!;
  const g = gradeLead(after, cfg, findCategory(after.lead.category_key), learning(outcomeStats()));
  return { full: after, changed: g.verdict === 'pass' ? null : `${before} -> ${audit.website_status}, no longer passes (${missing(g)})` };
}

export async function autoPick(opts: { max?: number; dryRun?: boolean; cfg?: PickConfig; recheck?: boolean } = {}): Promise<AutoPickResult> {
  const cfg = opts.cfg ?? loadPick();
  const alreadyPicked = new Set((openDb().prepare('SELECT lead_id FROM picks').all() as { lead_id: number }[]).map((r) => r.lead_id));
  const trades = learning(outcomeStats());
  const overall = trades.overall;
  const { eligible, skipped } = filterCandidates(fullLeads({ statuses: ['new'] }), cfg, alreadyPicked, trades, { freshDays: cfg.auto.audit_fresh_days });
  const week = picksThisWeek();
  const { picked: provisional, skipped: capped } = applyDiversity(eligible, cfg, week, opts.max ?? cfg.diversity.max_per_week);
  const rechecked: AutoPickResult['rechecked'] = [];
  const picked: Candidate[] = [];
  if (opts.dryRun) return { picked: provisional, skipped: [...skipped, ...capped], rechecked, overall, trades, dryRun: true };
  try {
    for (const c of provisional) {
      if (opts.recheck !== false) {
        const r = await recheck(c.full, cfg);
        if (r.changed) { rechecked.push({ slug: c.full.lead.slug, before: c.full.audit?.website_status ?? 'none', after: r.changed }); skipped.push({ slug: c.full.lead.slug, name: c.full.lead.name, why: `re-check: ${r.changed}` }); continue; }
      }
      commitPick(c.full, 'auto', c.reasons.join('; '), c.pickScore, c.buildability);
      picked.push(c);
    }
  } finally {
    await closeBrowser();
  }
  log.info(`pick: ${picked.length} picked, ${skipped.length + capped.length} skipped${rechecked.length ? `, ${rechecked.length} dropped on re-check` : ''}`);
  return { picked, skipped: [...skipped, ...capped], rechecked, overall, trades, dryRun: false };
}

export function commitPick(full: FullLead, by: 'auto' | 'manual', reason: string, pickScore: number | null, buildability: number | null) {
  const b = ensureBuild(full.lead.id);
  if (b.state !== 'picked') updateBuild(full.lead.id, { state: 'picked', failed_step: null, last_error: null, step_attempts: 0 });
  recordPick(full.lead.id, by, reason, pickScore, buildability);
  setStatus(full.lead.slug, 'shortlisted', `${by === 'auto' ? 'auto-picked' : 'picked'}: ${reason.slice(0, 160)}`);
  // The call checkpoint: anyone who can't be cold emailed waits for a thirty-second call before the build.
  if (loadCheckpoints().call && needsCall(full) && consentOf(full.lead.id)?.answer !== 'yes') {
    updateBuild(full.lead.id, { state: 'awaiting_call' });
    setStatus(full.lead.slug, 'shortlisted', 'waiting for your call before the build (Overview tab, or pnpm pipeline call)');
  }
}

/**
 * What they said on the call. Yes: the build goes ahead (tonight's job, or `pnpm pipeline build`) and the pitch is
 * a consented WhatsApp or email. No: the pick is dropped, nothing is built, and the business joins the do-not-contact list.
 */
export function recordCallOutcome(slug: string, answer: ConsentAnswer, note: string | null): string {
  const full = getFullLead(slug);
  if (!full) return `No lead ${slug}`;
  const b = getBuild(full.lead.id);
  if (!b || !['picked', 'awaiting_call'].includes(b.state)) return `${slug} is ${b?.state ?? 'not picked'}; the call comes before the build`;
  recordConsent(full.lead.id, answer, note);
  if (answer === 'yes') {
    updateBuild(full.lead.id, { state: 'picked' });
    setStatus(slug, 'shortlisted', `said yes on the phone${note ? `: ${note}` : ''}. Build goes ahead; send the preview by ${full.lead.phone_e164?.startsWith('+447') ? 'WhatsApp' : 'the channel they gave'}`);
    return `${full.lead.name}: yes. The build goes ahead.`;
  }
  removePick(full.lead.id);
  openDb().prepare("DELETE FROM builds WHERE lead_id = ? AND state IN ('picked', 'awaiting_call')").run(full.lead.id);
  applyStatus(slug, 'lost', `said no on the phone${note ? `: ${note}` : ''}; nothing built`);
  return `${full.lead.name}: no. Nothing built, and they won't be contacted again.`;
}

export function pickManual(slugs: string[]): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const full = getFullLead(slug);
    if (!full) { missing.push(slug); continue; }
    commitPick(full, 'manual', 'picked by hand', full.score?.total ?? null, null);
    ok.push(slug);
  }
  return { ok, missing };
}

export function unpick(slug: string): string {
  const full = getFullLead(slug);
  if (!full) return `No lead ${slug}`;
  const b = getBuild(full.lead.id);
  if (b && b.state !== 'picked') return `${slug} is ${b.state}; only a lead that hasn't started building can be unpicked`;
  removePick(full.lead.id);
  if (b) openDb().prepare('DELETE FROM builds WHERE lead_id = ? AND state = ?').run(full.lead.id, 'picked');
  setStatus(slug, 'new', 'unpicked');
  return `${full.lead.name}: back to new`;
}

export function pickedQueue(): { lead_id: number; slug: string; name: string; pick_score: number | null; picked_at: string }[] {
  return openDb().prepare(`SELECT p.lead_id, l.slug, l.name, p.pick_score, p.picked_at FROM picks p JOIN leads l ON l.id = p.lead_id JOIN builds b ON b.lead_id = p.lead_id
    WHERE b.state = 'picked' ORDER BY p.pick_score DESC NULLS LAST, p.picked_at`).all() as unknown as { lead_id: number; slug: string; name: string; pick_score: number | null; picked_at: string }[];
}

/** What the operator reads: picked with reasons, skipped grouped by reason. */
export function explain(r: AutoPickResult): string {
  const lines: string[] = [];
  lines.push(r.dryRun ? `Would pick ${r.picked.length}:` : `Picked ${r.picked.length}:`);
  r.picked.forEach((c, i) => lines.push(`  ${i + 1}. ${c.full.lead.name} (${c.full.lead.slug}) pick ${c.pickScore}`, ...c.reasons.map((x) => `       ${x}`)));
  if (r.rechecked.length) { lines.push('Dropped on re-check:'); r.rechecked.forEach((x) => lines.push(`  ${x.slug}: ${x.after}`)); }
  const groups = new Map<string, number>();
  for (const s of r.skipped) { const k = s.gates ? `failed ${s.gates.join(' + ')}` : s.why.replace(/\d+/g, 'N'); groups.set(k, (groups.get(k) ?? 0) + 1); }
  lines.push(`Skipped ${r.skipped.length}:`);
  [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([why, n]) => lines.push(`  ${n.toString().padStart(4)}  ${why}`));
  if (r.overall !== null) {
    lines.push(`Outcomes so far: ${(r.overall * 100).toFixed(0)}% reply or win overall.`);
    const cfg = loadPick();
    for (const k of r.trades.outcomes.keys()) lines.push(`  ${tradeValue(findCategory(k), r.trades, cfg).detail}`);
  }
  return lines.join('\n');
}
