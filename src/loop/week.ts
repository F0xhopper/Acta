/**
 * The Sunday job: sweep, audit, entity, score, yields, leaderboard, pick. Writes out/REVIEW.md for Monday morning.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../config.js';
import { auditMany } from '../audit/index.js';
import { enrichEntities } from '../discover/entity.js';
import { scoreAll } from '../score/score.js';
import { writeLeaderboard } from '../report/leaderboard.js';
import { runSweep, updateYields } from '../sweep/index.js';
import { autoPick, explain, pickedQueue } from '../pick/index.js';
import { doctor, doctorOk, formatDoctor } from '../doctor.js';
import { log } from '../util/log.js';
import { loadAutomation } from './automation.js';

export interface WeekOpts { dryRun?: boolean; max?: number; skipSweep?: boolean }

export async function runWeek(opts: WeekOpts = {}): Promise<string> {
  const checks = await doctor();
  if (!doctorOk(checks)) {
    const msg = `week: refusing to run, prerequisites missing:\n${formatDoctor(checks.filter((c) => c.required && !c.ok))}`;
    log.error(msg);
    return msg;
  }
  const started = new Date();
  const lines: string[] = [`# Week of ${started.toISOString().slice(0, 10)}`, ''];

  const auto = loadAutomation();
  const sweep = opts.skipSweep || !auto.sweep ? null : await runSweep({ dryRun: opts.dryRun });
  if (!auto.sweep) lines.push('## Sweep', '', 'Off: searches are run by hand (config/build.yaml, automation).', '');
  if (sweep) {
    lines.push(`## Sweep${opts.dryRun ? ' (dry run)' : ''}`, '', `${sweep.plan.run.length} searches due, ${sweep.plan.estimatedRequests} of ${sweep.plan.budget} requests${sweep.stoppedEarly ? `, stopped early: ${sweep.stoppedEarly}` : ''}.`, '');
    if (sweep.ran.length) { lines.push('| Search | Found | New |', '|---|---|---|', ...sweep.ran.map((r) => `| ${r.query} | ${r.found} | ${r.inserted} |`), ''); }
    else lines.push(...sweep.plan.run.map((r) => `- would run: ${r.query} (${r.cost} requests)`), '');
    if (sweep.plan.skipped.length) lines.push(`Skipped: ${sweep.plan.skipped.slice(0, 8).map((s) => `${s.query} (${s.why})`).join('; ')}${sweep.plan.skipped.length > 8 ? ' …' : ''}`, '');
  }

  if (!opts.dryRun) {
    const a = await auditMany({});
    lines.push('## Audit', '', `${a.audited} audited, ${a.errors} errors${a.rescued ? `, ${a.rescued} rescued by browser` : ''}.`, '');
    await enrichEntities({});
    const s = scoreAll({});
    const y = updateYields();
    lines.push('## Score', '', `${s.scored} scored: ${Object.entries(s.byTier).map(([k, n]) => `${k} ${n}`).join(', ')}. ${y.updated} searches re-yielded${y.retired.length ? `, retired: ${y.retired.join(', ')}` : ''}.`, '');
    writeLeaderboard();
  }

  if (auto.autoPick) {
    const pick = await autoPick({ dryRun: opts.dryRun, max: opts.max });
    lines.push(`## Picks${opts.dryRun ? ' (dry run)' : ''}`, '', '```', explain(pick), '```', '');
  } else lines.push('## Picks', '', 'Off: you pick by hand (config/build.yaml, automation).', '');
  const queue = pickedQueue();
  lines.push('## Build queue', '', queue.length ? queue.map((q, i) => `${i + 1}. ${q.name} (${q.slug}) pick ${q.pick_score ?? '-'}`).join('\n') : 'empty', '',
    'Builds run overnight Monday and Tuesday (`pnpm pipeline build --picked --max 5`). Review with `pnpm pipeline review`.', '',
    `Leaderboard: out/LEADERBOARD.md. Took ${Math.round((Date.now() - started.getTime()) / 60000)} min.`);
  const text = lines.join('\n') + '\n';
  if (!opts.dryRun) writeFileSync(join(OUT_DIR, 'REVIEW.md'), text);
  return text;
}
