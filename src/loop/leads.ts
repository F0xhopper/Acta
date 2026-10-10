/**
 * The daily lead run: the sweep picks the best searches from the opportunity map, then each new batch is audited,
 * matched with Companies House and scored, the map re-learns, and the suggestions refresh. Small and daily instead
 * of big and weekly, so new leads arrive steadily and each day's searches learn from yesterday's.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../config.js';
import { auditMany } from '../audit/index.js';
import { findEmails } from './emails.js';
import { enrichEntities } from '../discover/entity.js';
import { scoreAll } from '../score/score.js';
import { writeLeaderboard } from '../report/leaderboard.js';
import { runSweep, updateYields } from '../sweep/index.js';
import { suggestions } from '../pick/suggest.js';
import { log } from '../util/log.js';

export interface LeadRunResult { text: string; searches: number; found: number; inserted: number; goodNew: number }

export async function runLeads(opts: { dryRun?: boolean; budget?: number } = {}): Promise<LeadRunResult> {
  const started = new Date();
  const sweep = await runSweep({ dryRun: opts.dryRun, budget: opts.budget });
  const lines = [`# Leads, ${started.toISOString().slice(0, 10)}`, ''];
  if (opts.dryRun) {
    lines.push(`Would run ${sweep.plan.run.length} searches (${sweep.plan.estimatedRequests} of ${sweep.plan.budget} requests):`, '',
      ...sweep.plan.run.map((r) => `- ${r.query}: ~${((r.rate ?? 0) * 10).toFixed(1)} good per 10. ${r.why?.join('; ') ?? ''}`));
    return { text: lines.join('\n'), searches: sweep.plan.run.length, found: 0, inserted: 0, goodNew: 0 };
  }
  for (const r of sweep.ran) {
    await auditMany({ query: r.query });
    await enrichEntities({ query: r.query });
  }
  // Emails for the new leads: their own site (found by name when Google links none), then the open web.
  scoreAll({});
  for (const r of sweep.ran) await findEmails({ query: r.query });
  const y = updateYields();
  writeLeaderboard();
  const fresh = suggestions({ limit: 50, nearMisses: false }).filter((s) => s.isNew && new Date(s.discoveredAt) >= started);
  const found = sweep.ran.reduce((a, r) => a + r.found, 0);
  const inserted = sweep.ran.reduce((a, r) => a + r.inserted, 0);
  lines.push(`${sweep.ran.length} searches, ${found} found, ${inserted} new${sweep.stoppedEarly ? ` (stopped early: ${sweep.stoppedEarly})` : ''}.`, '');
  if (sweep.ran.length) lines.push('| Search | Found | New |', '|---|---|---|', ...sweep.ran.map((r) => `| ${r.query} | ${r.found} | ${r.inserted} |`), '');
  if (y.retired.length) lines.push(`Retired for low yield: ${y.retired.join(', ')}.`, '');
  lines.push(fresh.length ? `## ${fresh.length} new leads pass every gate` : '## No new leads passed today', '');
  for (const s of fresh.slice(0, 10)) lines.push(`- **${s.name}** (${s.categoryLabel}, ${s.area}) grade ${s.grade}: ${s.gates.map((g) => g.detail).slice(1, 4).join('; ')}`);
  lines.push('', `Took ${Math.round((Date.now() - started.getTime()) / 60000)} min. Open the Leads page to pick.`);
  const text = lines.join('\n') + '\n';
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'NEW-LEADS.md'), text);
  log.info(`leads: ${sweep.ran.length} searches, ${inserted} new leads, ${fresh.length} new suggestions`);
  return { text, searches: sweep.ran.length, found, inserted, goodNew: fresh.length };
}
