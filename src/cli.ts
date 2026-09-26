import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { envInt, findCategory, loadCategories } from './config.js';
import { finishRun, getFullLead, setCategoryForQuery, startRun } from './db/queries.js';
import { discover } from './discover/index.js';
import { enrichEntities } from './discover/entity.js';
import { placeReviews, type Budget, type PlaceReview } from './discover/places.js';
import { auditMany } from './audit/index.js';
import { scoreAll } from './score/score.js';
import { writeShortlist, runOutDir } from './report/shortlist.js';
import { writePack } from './report/pack.js';
import { summaryText, writeSummary } from './report/summary.js';
import { writeLeaderboard } from './report/leaderboard.js';
import { hook } from './report/format.js';
import { displayUkPhone } from './util/phone.js';
import type { FullLead } from './db/types.js';
import { applyStatus } from './crm/status.js';
import { log, setVerbose } from './util/log.js';

const program = new Command();
program.name('pipeline').description('Find Birmingham businesses that need a website, audit them, score them, shortlist them.');
program.option('-v, --verbose', 'verbose logging').hook('preAction', (cmd) => { if (cmd.opts().verbose) setVerbose(true); });

function printTop(rows: FullLead[], n = 5) {
  rows.slice(0, n).forEach((r, i) => console.log(`  ${i + 1}. [${r.score?.tier} ${r.score?.total}] ${r.lead.name}  ${displayUkPhone(r.lead.phone_e164) || 'no phone'}  ${hook(r)}`));
}

const budget = (): Budget => ({ used: 0, max: envInt('PLACES_MAX_REQUESTS_PER_RUN', 30) });
const tiersOf = (s?: string) => (s ? s.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) : undefined);

async function reviewsFor(placeId: string, want: boolean, b: Budget): Promise<PlaceReview[]> {
  if (!want) return [];
  try { return await placeReviews(placeId, b); } catch (e) { log.warn(`reviews failed: ${(e as Error).message}`); return []; }
}

program.command('discover').argument('<query>', 'e.g. "plumbers in Erdington"')
  .option('--pages <n>', 'pages of 20 results, max 3', '3')
  .option('--dry-run', 'print planned requests, make none')
  .option('--any-postcode', 'keep results outside B postcodes')
  .action(async (query: string, o) => {
    const r = await discover(query, { pages: Number(o.pages), dryRun: o.dryRun, anyPostcode: o.anyPostcode, budget: budget() });
    console.log(JSON.stringify({ query: r.parsed.raw, textQuery: r.parsed.textQuery, category: r.parsed.categoryKey, area: r.parsed.area, found: r.found, inserted: r.inserted, updated: r.updated, skipped: r.skipped, chains: r.chains }, null, 2));
  });

program.command('audit').description('Classify and audit websites for leads')
  .option('--query <q>').option('--slug <slug>').option('--force', 're-audit even if fresh')
  .option('--no-psi', 'skip PageSpeed Insights').option('--no-screenshots', 'skip Playwright screenshots').option('--dry-run')
  .action(async (o) => { console.log(JSON.stringify(await auditMany({ query: o.query, slug: o.slug, force: o.force, psi: o.psi, screenshots: o.screenshots, dryRun: o.dryRun }), null, 2)); });

program.command('entity').description('Match leads against Companies House')
  .option('--query <q>').option('--slug <slug>').option('--force').option('--dry-run')
  .action(async (o) => { console.log(JSON.stringify(await enrichEntities({ query: o.query, slug: o.slug, force: o.force, dryRun: o.dryRun }), null, 2)); });

program.command('score').option('--query <q>').action((o) => { console.log(JSON.stringify(scoreAll({ query: o.query }), null, 2)); });

program.command('shortlist').option('--query <q>').option('--top <n>', 'max rows', '25').option('--min-viability <n>').option('--tiers <list>', 'e.g. A,B')
  .action((o) => {
    const r = writeShortlist({ query: o.query, top: Number(o.top), minViability: o.minViability ? Number(o.minViability) : undefined, tiers: tiersOf(o.tiers) });
    for (const full of r.rows) writePack(r.outDir, full);
    writeSummary(r.outDir, o.query);
    const lb = writeLeaderboard();
    console.log(`${r.rows.length} leads -> ${r.mdPath}`);
    printTop(r.rows);
    console.log(`leaderboard -> ${lb.mdPath}`);
  });

program.command('pack').argument('[slug]').option('--shortlist', 'pack everything on the current shortlist').option('--query <q>').option('--top <n>', 'max shortlist rows', '25')
  .option('--reviews', 'fetch review snippets (Place Details, higher-priced SKU)')
  .action(async (slug: string | undefined, o) => {
    const b = budget();
    if (slug) {
      const full = getFullLead(slug);
      if (!full) { console.error(`No lead ${slug}`); process.exitCode = 1; return; }
      console.log(writePack(runOutDir(full.lead.source_query), full, await reviewsFor(full.lead.place_id, !!o.reviews, b)));
      return;
    }
    if (!o.shortlist) { console.error('Give a slug or --shortlist'); process.exitCode = 1; return; }
    const r = writeShortlist({ query: o.query, top: Number(o.top) });
    for (const full of r.rows) console.log(writePack(r.outDir, full, await reviewsFor(full.lead.place_id, !!o.reviews, b)));
  });

program.command('status').argument('<slug>').argument('<status>').option('--note <text>')
  .action((slug: string, status: string, o) => {
    const r = applyStatus(slug, status, o.note);
    console.log(r.message);
    if (!r.ok) { process.exitCode = 1; return; }
    console.log(`leaderboard -> ${writeLeaderboard().mdPath}`);
  });

program.command('leaderboard').description('Rank every lead across every search, plus in-progress and results')
  .option('--top <n>', 'rows in the full table', '50')
  .action((o) => { const r = writeLeaderboard(Number(o.top)); console.log(`${r.ready.length} leads ready to pitch -> ${r.mdPath}`); printTop(r.ready, 10); });

program.command('category').description('Set the category for every lead from a query, e.g. after the parser could not match one')
  .requiredOption('--query <q>').requiredOption('--set <key>')
  .action((o) => {
    if (!findCategory(o.set)) { console.error(`Unknown category "${o.set}". Known: ${loadCategories().map((c) => c.key).join(', ')}`); process.exitCode = 1; return; }
    const n = setCategoryForQuery(o.query, o.set);
    console.log(`${n} leads set to ${o.set}. Now run: pipeline score --query "${o.query}"`);
  });

program.command('stats').option('--query <q>').action((o) => { console.log(summaryText(o.query)); });

program.command('run').description('discover + audit + entity + score + shortlist + pack for one query or a file of queries')
  .argument('[query]').option('--file <path>', 'one query per line')
  .option('--top <n>', 'max shortlist rows', '25').option('--pages <n>', 'pages of 20 results, max 3', '3').option('--min-viability <n>').option('--tiers <list>')
  .option('--no-psi').option('--no-screenshots').option('--reviews').option('--any-postcode').option('--dry-run')
  .action(async (query: string | undefined, o) => {
    const queries = o.file ? readFileSync(o.file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : query ? [query] : [];
    if (!queries.length) { console.error('Give a query or --file'); process.exitCode = 1; return; }
    const b = budget();
    for (const q of queries) {
      const runId = startRun(q);
      log.info(`=== run ${runId}: ${q} ===`);
      const d = await discover(q, { pages: Number(o.pages), dryRun: o.dryRun, anyPostcode: o.anyPostcode, runId, budget: b });
      if (o.dryRun) { await auditMany({ query: d.parsed.raw, dryRun: true }); await enrichEntities({ query: d.parsed.raw, dryRun: true }); finishRun(runId); continue; }
      await auditMany({ query: d.parsed.raw, psi: o.psi, screenshots: o.screenshots, runId });
      await enrichEntities({ query: d.parsed.raw, runId });
      scoreAll({ query: d.parsed.raw });
      const s = writeShortlist({ query: d.parsed.raw, top: Number(o.top), minViability: o.minViability ? Number(o.minViability) : undefined, tiers: tiersOf(o.tiers) });
      for (const full of s.rows) writePack(s.outDir, full, await reviewsFor(full.lead.place_id, !!o.reviews, b));
      const summaryPath = writeSummary(s.outDir, d.parsed.raw, runId);
      finishRun(runId);
      log.info(`shortlist: ${s.rows.length} leads -> ${s.mdPath}`);
      log.info(`summary: ${summaryPath}`);
      printTop(s.rows);
    }
    if (!o.dryRun) log.info(`leaderboard: ${writeLeaderboard().mdPath}`);
    log.info(`Places requests used this invocation: ${b.used}/${b.max}`);
  });

program.parseAsync(process.argv).catch((e) => { log.error((e as Error).message); process.exitCode = 1; });
