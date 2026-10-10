/**
 * The Sunday job: re-audit, entity, score, yields, leaderboard, pick. Writes out/REVIEW.md for Monday morning.
 * Discovery itself runs daily in src/loop/leads.ts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR } from '../config.js';
import { auditMany } from '../audit/index.js';
import { enrichEntities } from '../discover/entity.js';
import { scoreAll } from '../score/score.js';
import { writeLeaderboard } from '../report/leaderboard.js';
import { updateYields } from '../sweep/index.js';
import { autoPick, explain, pickedQueue } from '../pick/index.js';
import { doctor, doctorOk, formatDoctor } from '../doctor.js';
import { log } from '../util/log.js';
import { loadAutomation } from './automation.js';

export interface WeekOpts { dryRun?: boolean; max?: number }

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
  lines.push('## Discovery', '', auto.sweep ? 'Runs daily (`pnpm pipeline leads`, the com.acta.leads job). Today\'s batch is in out/NEW-LEADS.md.' : 'Off: searches are run by hand (config/build.yaml, automation).', '');

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
