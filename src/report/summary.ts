import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRun, stats } from '../db/queries.js';

export function summaryText(query?: string, runId?: number): string {
  const s = stats(query);
  const run = runId ? getRun(runId) : undefined;
  const table = (rows: { k: string; n: number }[]) => rows.map((r) => `| ${r.k} | ${r.n} |`).join('\n') || '| (none) | 0 |';
  return `# Summary${query ? `: ${query}` : ''}

| Metric | Count |
|---|---|
| Leads | ${s.leads} |
| Audited | ${s.audited} |
| Scored | ${s.scored} |
| Flagged as chains | ${s.chains} |
${run ? `| Places requests this run | ${run.places_requests} |\n| PSI requests this run | ${run.psi_requests} |\n| Companies House requests this run | ${run.ch_requests} |` : ''}

## By website status

| Status | Count |
|---|---|
${table(s.byStatus)}

## By tier

| Tier | Count |
|---|---|
${table(s.byTier)}

## By entity match

| Match | Count |
|---|---|
${table(s.byEntity)}

## By pipeline status

| Status | Count |
|---|---|
${table(s.byPipeline)}
`;
}

export function writeSummary(outDir: string, query?: string, runId?: number): string {
  const p = join(outDir, 'summary.md');
  writeFileSync(p, summaryText(query, runId));
  return p;
}
