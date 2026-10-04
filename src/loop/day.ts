/**
 * The weekday morning job: tear down stale previews, refresh the leaderboard, print the review queue.
 * Outreach sends and inbox polling slot in here when that stage exists.
 */
import { teardown } from '../build/index.js';
import { listBuilds } from '../build/queries.js';
import { writeLeaderboard } from '../report/leaderboard.js';
import { getFullLead } from '../db/queries.js';
import { log } from '../util/log.js';

export const STALE_PREVIEW_DAYS = 60;

export async function runDay(opts: { dryRun?: boolean } = {}): Promise<string> {
  const lines: string[] = [`Day ${new Date().toISOString().slice(0, 10)}`];
  const stale = listBuilds({ states: ['preview_ready', 'approved'] }).filter((b) => (Date.now() - new Date(b.updated_at).getTime()) / 86_400_000 > STALE_PREVIEW_DAYS);
  const closed = listBuilds({ states: ['preview_ready', 'approved', 'built', 'gated', 'pushed', 'deployed'] }).filter((b) => ['lost', 'do_not_contact'].includes(getFullLead(b.slug)?.pipeline.status ?? ''));
  for (const b of [...stale, ...closed]) {
    if (opts.dryRun) { lines.push(`would tear down ${b.slug}`); continue; }
    const notes = await teardown(b.slug);
    lines.push(`torn down ${b.slug}: ${notes.join('; ')}`);
  }
  if (!opts.dryRun) writeLeaderboard();
  const review = listBuilds({ states: ['preview_ready', 'failed'] });
  lines.push(`${review.length} build${review.length === 1 ? '' : 's'} waiting for review${review.length ? ': ' + review.map((b) => b.name).join(', ') : ''}.`);
  const text = lines.join('\n');
  log.info(text.replace(/\n/g, ' | '));
  return text;
}
