import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fullLeads, getRun } from '../db/queries.js';
import { CHANNEL_LABEL, countBy, esc, groupExclusion, hook, link, nextAction, STATUS_LABEL } from './format.js';

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const CONTACTED = ['contacted', 'followup_1', 'followup_2', 'replied', 'won', 'lost', 'do_not_contact'];

export function summaryText(query?: string, runId?: number, outDir?: string): string {
  const all = fullLeads({ query });
  const run = runId ? getRun(runId) : undefined;
  const ready = all.filter((r) => ['A', 'B', 'C'].includes(r.score?.tier ?? '') && r.pipeline.status === 'new');
  const excluded = all.filter((r) => r.score?.tier === 'X');
  const tiers = countBy(ready, (r) => r.score!.tier);
  const contacted = all.filter((r) => CONTACTED.includes(r.pipeline.status));
  const replied = all.filter((r) => ['replied', 'won'].includes(r.pipeline.status));
  const won = all.filter((r) => r.pipeline.status === 'won');
  const statuses = countBy(all.filter((r) => r.audit), (r) => r.audit!.website_status);
  const reasons = countBy(excluded, (r) => groupExclusion(r.score?.excluded_reason ?? null));
  const chan = countBy(ready.filter((r) => r.score!.tier === 'A'), (r) => r.score!.channel);

  const md: string[] = [
    `# Summary: ${query ?? 'all searches'}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.`,
    '',
    '## Funnel',
    '',
    '| Stage | Count | Of found |',
    '|---|---|---|',
    `| Found on Google | ${all.length} | 100% |`,
    `| Excluded | ${excluded.length} | ${pct(excluded.length, all.length)} |`,
    `| Ready to pitch | ${ready.length} (A ${tiers.A ?? 0}, B ${tiers.B ?? 0}, C ${tiers.C ?? 0}) | ${pct(ready.length, all.length)} |`,
    `| Contacted | ${contacted.length} | ${pct(contacted.length, all.length)} |`,
    `| Replied | ${replied.length} | ${pct(replied.length, contacted.length)} of contacted |`,
    `| Won | ${won.length} | ${pct(won.length, contacted.length)} of contacted |`,
    '',
  ];

  const top = ready.slice(0, 5);
  if (top.length) {
    md.push('## Top 5', '');
    top.forEach((r, i) => {
      const pack = outDir ? ` ${link('Pitch pack', `leads/${r.lead.slug}/notes.md`)}` : '';
      md.push(`${i + 1}. **${link(r.lead.name, r.lead.google_maps_url)}**, tier ${r.score!.tier}, ${r.score!.total}/100. ${esc(hook(r))} ${esc(nextAction(r))}${pack}`);
    });
    md.push('');
  }

  md.push('## Websites found', '', '| Status | Count | Share |', '|---|---|---|',
    ...Object.entries(statuses).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${STATUS_LABEL[k] ?? k} | ${n} | ${pct(n, all.length)} |`), '');

  if (excluded.length) {
    md.push('## Why leads were excluded', '', '| Reason | Count |', '|---|---|',
      ...Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${esc(k)} | ${n} |`), '');
  }

  if (run) {
    md.push('## API usage this run', '', '| API | Requests |', '|---|---|',
      `| Google Places | ${run.places_requests} |`, `| PageSpeed Insights | ${run.psi_requests} |`, `| Companies House | ${run.ch_requests} |`, '');
  }

  const next: string[] = [];
  if (tiers.A) next.push(`Pitch the ${tiers.A} tier A leads first: ${Object.entries(chan).map(([k, n]) => `${n} ${(CHANNEL_LABEL[k] ?? k).toLowerCase()}`).join(', ')}.`);
  if (tiers.B) next.push(`Then the ${tiers.B} tier B leads. Their phone screenshot is the pitch.`);
  if (ready.length < 10) next.push('Thin list. Try a neighbouring area or a more specific trade word.');
  if ((reasons['Site is adequate'] ?? 0) > all.length / 2) next.push('Most businesses here already have decent sites. Work tier A, then move to a different area.');
  if ((reasons['Not a customer (station, hotel, school ...)'] ?? 0) > 3) next.push('The search picked up stations, hotels or similar. Use a more specific trade word next time.');
  next.push('Mark each lead as you go so it drops off future lists: `pnpm pipeline status <slug> contacted`.');
  md.push('## What to do next', '', ...next.map((n) => `- ${n}`), '');
  return md.join('\n');
}

export function writeSummary(outDir: string, query?: string, runId?: number): string {
  const p = join(outDir, 'summary.md');
  writeFileSync(p, summaryText(query, runId, outDir));
  return p;
}
