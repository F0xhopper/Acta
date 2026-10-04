import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { envInt, findCategory, loadCategories } from './config.js';
import { finishRun, getFullLead, setCategoryForQuery, startRun } from './db/queries.js';
import { discover } from './discover/index.js';
import { enrichEntities } from './discover/entity.js';
import { BudgetExceeded, placeReviews, type Budget, type PlaceReview } from './discover/places.js';
import { expandAreas } from './discover/areas.js';
import { auditMany, backfillDescriptions } from './audit/index.js';
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
import { approve, buildLead, reject, teardown, type BuildOpts } from './build/index.js';
import { getBuild, listBuilds, recentEvents } from './build/queries.js';
import { loadGather, loadResearch } from './build/apis.js';
import { buildDir } from './build/log.js';
import { join } from 'node:path';
import { runSweep, sweepStates, updateYields } from './sweep/index.js';
import { planSweep } from './sweep/plan.js';
import { loadSweep } from './sweep/config.js';
import { autoPick, explain, pickManual, pickedQueue, unpick } from './pick/index.js';
import { runWeek } from './loop/week.js';
import { runDay } from './loop/day.js';
import { installSchedule, scheduleStatus, uninstallSchedule } from './loop/schedule.js';
import { doctor, formatDoctor } from './doctor.js';

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
  .option('--variants', "also search the category's alternative terms (e.g. heating engineer, boiler repair)")
  .action(async (query: string, o) => {
    const r = await discover(query, { pages: Number(o.pages), dryRun: o.dryRun, anyPostcode: o.anyPostcode, budget: budget(), variants: o.variants });
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

program.command('describe').description('Fill in website descriptions for live sites audited before descriptions existed')
  .option('--query <q>').option('--force', 'refetch even if a description exists')
  .action(async (o) => { console.log(JSON.stringify(await backfillDescriptions({ query: o.query, force: o.force }))); });

program.command('stats').option('--query <q>').action((o) => { console.log(summaryText(o.query)); });

program.command('run').description('discover + audit + entity + score + shortlist + pack for one query or a file of queries')
  .argument('[query]').option('--file <path>', 'one query per line')
  .option('--top <n>', 'max shortlist rows', '25').option('--pages <n>', 'pages of 20 results, max 3', '3').option('--min-viability <n>').option('--tiers <list>')
  .option('--areas <group|list>', 'fan the trade across an area group from config/areas.yaml, or a comma list')
  .option('--variants', "also search the category's alternative terms in each area")
  .option('--no-psi').option('--no-screenshots').option('--reviews').option('--any-postcode').option('--dry-run')
  .action(async (query: string | undefined, o) => {
    let queries = o.file ? readFileSync(o.file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : query ? [query] : [];
    if (o.areas) queries = queries.flatMap((q) => expandAreas(q, o.areas));
    if (queries.length > 1) log.info(`running ${queries.length} searches: ${queries.join(' | ')}`);
    if (!queries.length) { console.error('Give a query or --file'); process.exitCode = 1; return; }
    const b = budget();
    for (const q of queries) {
      const runId = startRun(q);
      log.info(`=== run ${runId}: ${q} ===`);
      let d;
      try {
        d = await discover(q, { pages: Number(o.pages), dryRun: o.dryRun, anyPostcode: o.anyPostcode, runId, budget: b, variants: o.variants });
      } catch (e) {
        if (e instanceof BudgetExceeded) { log.warn(`${e.message} Stopping before "${q}". Cached searches rerun free.`); finishRun(runId); break; }
        throw e;
      }
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

// ---------- build stage ----------

const buildOpts = (o: Record<string, unknown>, b: Budget): BuildOpts => ({
  budget: b, sandbox: !!o.sandbox, deploy: o.deploy === false ? false : o.deploy === true ? true : undefined, agent: o.agent !== false,
  research: o.research !== false, force: !!o.force, fastGates: !!o.fastGates, dryRun: !!o.dryRun,
  maxTurns: o.maxTurns ? Number(o.maxTurns) : undefined, maxMinutes: o.maxMinutes ? Number(o.maxMinutes) : undefined,
});

function printOutcome(r: { slug: string; name: string; state: string; repoUrl: string | null; previewUrl: string | null; evidence: string | null; dir: string; error: string | null }) {
  console.log('');
  console.log(`${r.name} (${r.slug}): ${r.state}${r.error ? ` at ${r.error}` : ''}`);
  if (r.repoUrl) console.log(`  repo:     ${r.repoUrl}`);
  console.log(`  local:    ${r.dir}`);
  if (r.previewUrl) console.log(`  preview:  ${r.previewUrl}`);
  else if (r.state === 'preview_ready') console.log(`  preview:  not deployed. cd ${r.dir} && pnpm dev`);
  if (r.evidence) console.log(`  evidence: ${r.evidence}`);
  console.log(`  log:      ${join(buildDir(r.slug), 'build.log')}`);
}

program.command('build').description('Build a site for a business: gather its brand and facts, create a repo, design it, test it, deploy a preview')
  .argument('[business]', 'business name, or a lead slug from a shortlist')
  .option('--picked', 'build the picked queue in pick-score order')
  .option('--max <n>', 'with --picked: how many to build', '5')
  .option('--sandbox', 'no GitHub repo, no Vercel; everything stays under sites/')
  .option('--no-agent', 'skip the design agent (infrastructure and placeholder only)')
  .option('--no-research', 'skip Pinterest and competitor research')
  .option('--deploy', 'deploy even in a case where it would be skipped').option('--no-deploy', 'never deploy')
  .option('--fast-gates', 'skip Lighthouse in the gates')
  .option('--max-turns <n>').option('--max-minutes <n>')
  .option('--force', 're-gather, re-copy the starter and rebuild from the start')
  .option('--dry-run', 'show the steps that would run')
  .action(async (business: string | undefined, o) => {
    if (o.picked) {
      const queue = pickedQueue().slice(0, Number(o.max));
      if (!queue.length) { console.log('Picked queue is empty. Run: pnpm pipeline pick --auto'); return; }
      const perDay = envInt('BUILD_MAX_PER_DAY', 10);
      for (const q of queue.slice(0, perDay)) {
        const r = await buildLead(q.slug, buildOpts(o, budget()));
        printOutcome(r);
        if (r.error) process.exitCode = 1;
      }
      return;
    }
    if (!business) { console.error('Give a business name or slug, or --picked'); process.exitCode = 1; return; }
    const r = await buildLead(business, buildOpts(o, budget()));
    printOutcome(r);
    if (r.error) process.exitCode = 1;
  });

// ---------- discovery sweep and picking ----------

program.command('sweep').description('Run the discovery searches that are due, best yield first, within the request budget (config/sweep.yaml)')
  .option('--dry-run', 'show the plan only').option('--budget <n>', 'override the request budget')
  .action(async (o) => {
    const r = await runSweep({ dryRun: o.dryRun, budget: o.budget ? Number(o.budget) : undefined });
    console.log(`${o.dryRun ? 'Would run' : 'Ran'} ${r.plan.run.length} searches, ${r.plan.estimatedRequests}/${r.plan.budget} requests${r.stoppedEarly ? `, stopped early: ${r.stoppedEarly}` : ''}`);
    for (const x of o.dryRun ? r.plan.run.map((p) => ({ query: p.query, found: p.cost, inserted: 0 })) : r.ran) console.log(`  ${x.query}${o.dryRun ? ` (${x.found} requests)` : `: ${x.found} found, ${x.inserted} new`}`);
    if (r.plan.skipped.length) { console.log(`Skipped ${r.plan.skipped.length}:`); r.plan.skipped.slice(0, 12).forEach((x) => console.log(`  ${x.query}: ${x.why}`)); }
    if (!o.dryRun) { const y = updateYields(); if (y.retired.length) console.log(`Retired: ${y.retired.join(', ')}`); }
  });

program.command('searches').description('Every configured search with its runs, yield and retirement').action(() => {
  for (const s of sweepStates()) console.log(`${(s.yield ?? 0).toFixed(1).padStart(5)}  runs ${String(s.runs).padStart(2)}  ${s.retired ? 'RETIRED ' : ''}${s.query}${s.lastRunAt ? `  (last ${s.lastRunAt.slice(0, 10)})` : ''}`);
  const plan = planSweep(sweepStates(), loadSweep());
  console.log(`\nNext sweep would run ${plan.run.length}: ${plan.run.map((r) => r.query).join(' | ')}`);
});

program.command('pick').description('Pick leads to build: by slug, or --auto for the rule in config/pick.yaml')
  .argument('[slugs...]').option('--auto', 'apply the rule').option('--max <n>').option('--dry-run').option('--no-recheck', 'skip the fresh look at each site before picking')
  .action(async (slugs: string[], o) => {
    if (o.auto) { console.log(explain(await autoPick({ max: o.max ? Number(o.max) : undefined, dryRun: o.dryRun, recheck: o.recheck }))); return; }
    if (!slugs.length) { console.error('Give slugs, or --auto'); process.exitCode = 1; return; }
    const r = pickManual(slugs);
    console.log(`picked: ${r.ok.join(', ') || 'none'}${r.missing.length ? `\nnot found: ${r.missing.join(', ')}` : ''}`);
  });

program.command('unpick').argument('<slug>').action((slug: string) => { console.log(unpick(slug)); });

program.command('week').description('The Sunday job: sweep, audit, score, leaderboard, pick. Writes out/REVIEW.md')
  .option('--dry-run').option('--max <n>', 'picks').option('--skip-sweep')
  .action(async (o) => { console.log(await runWeek({ dryRun: o.dryRun, max: o.max ? Number(o.max) : undefined, skipSweep: o.skipSweep })); });

program.command('day').description('The weekday job: tear down stale previews, refresh the leaderboard, list the review queue')
  .option('--dry-run').action(async (o) => { console.log(await runDay({ dryRun: o.dryRun })); });

program.command('schedule').description('Install, remove or show the launchd jobs for week, builds and day').argument('<action>', 'install | uninstall | status')
  .option('--jobs <list>', 'install only these: week,day,builds')
  .action(async (action: string, o) => {
    const out = action === 'install' ? await installSchedule(o.jobs ? String(o.jobs).split(',') : undefined) : action === 'uninstall' ? await uninstallSchedule() : await scheduleStatus();
    out.forEach((l) => console.log(`  ${l}`));
  });

program.command('doctor').description('Check every prerequisite the pipeline needs').action(async () => {
  const checks = await doctor();
  console.log(formatDoctor(checks));
  if (!checks.filter((c) => c.required).every((c) => c.ok)) process.exitCode = 1;
});

program.command('gather').description('Gather brand and facts for a business without building').argument('<business>').option('--force')
  .action(async (business: string, o) => {
    const { resolveLead } = await import('./build/resolve.js');
    const full = await resolveLead(business, { budget: budget(), log: (m) => console.log(`  ${m}`) });
    const api = await loadGather();
    const r = await api.gather(full, { force: o.force, log: (m) => console.log(`  ${m}`) });
    const b = r.brand, f = r.facts;
    console.log(JSON.stringify({ dir: r.dir, logo: { quality: b.logo.quality, source: b.logo.source }, palette: b.palette, fonts: b.fonts, photos: b.photos.length, claims: f.claims.map((c) => c.claim), services: f.services.map((s) => s.name), areas: f.areas, competitors: f.competitors.map((c) => c.name), upsells: b.quality.upsells }, null, 2));
  });

program.command('builds').description('Every build: state, links, cost').option('--failed', 'only failed builds')
  .action((o) => {
    const rows = listBuilds({ states: o.failed ? ['failed'] : undefined });
    if (!rows.length) { console.log('No builds yet. Try: pnpm pipeline build "<business name>"'); return; }
    for (const b of rows) {
      const cost = b.agent_cost_usd !== null ? ` $${b.agent_cost_usd.toFixed(2)}` : '';
      const time = b.agent_seconds !== null ? ` ${Math.round(b.agent_seconds / 60)}min` : '';
      console.log(`${b.state.padEnd(14)} ${b.name.slice(0, 34).padEnd(34)} ${b.preview_url ?? b.repo_url ?? b.repo_dir ?? ''}${time}${cost}${b.state === 'failed' ? `
${' '.repeat(15)}at ${b.failed_step}: ${b.last_error?.slice(0, 160)}` : ''}`);
    }
  });

program.command('review').description('Previews waiting for your two-minute check, and failed builds')
  .action(() => {
    const rows = listBuilds({ states: ['preview_ready', 'failed'] });
    if (!rows.length) { console.log('Nothing to review.'); return; }
    for (const b of rows) {
      console.log(`\n${b.name} (${b.slug}) — ${b.state}`);
      if (b.state === 'failed') { console.log(`  failed at ${b.failed_step}: ${b.last_error}`); }
      if (b.preview_url) console.log(`  preview:  ${b.preview_url}`); else if (b.repo_dir) console.log(`  local:    cd ${b.repo_dir} && pnpm dev`);
      if (b.repo_url) console.log(`  repo:     ${b.repo_url}`);
      if (b.evidence_path) console.log(`  evidence: ${b.evidence_path}`);
      if (b.brand_json_path) console.log(`  brand:    ${b.brand_json_path}`);
      console.log(`  approve:  pnpm pipeline approve ${b.slug}`);
      console.log(`  reject:   pnpm pipeline reject ${b.slug} --note "..."`);
      const ev = recentEvents(b.lead_id, 4);
      for (const e of ev) console.log(`    ${e.at.slice(11, 19)} ${e.step ?? ''} ${e.message.slice(0, 120)}`);
    }
  });

program.command('approve').argument('<slug>').action((slug: string) => { console.log(approve(slug)); });

program.command('reject').argument('<slug>').requiredOption('--note <text>', 'what to change')
  .option('--sandbox').option('--no-deploy').option('--fast-gates').option('--max-turns <n>').option('--max-minutes <n>')
  .action(async (slug: string, o) => { const r = await reject(slug, o.note, buildOpts(o, budget())); printOutcome(r); if (r.error) process.exitCode = 1; });

program.command('teardown').argument('<slug>').option('--keep-repo', 'leave the GitHub repo alone').option('--yes', 'confirm')
  .action(async (slug: string, o) => {
    if (!o.yes) { console.error('This removes the Vercel project and archives the repo. Add --yes to confirm.'); process.exitCode = 1; return; }
    for (const n of await teardown(slug, { keepRepo: o.keepRepo })) console.log(`  ${n}`);
  });

program.command('research').description('Manage the Pinterest session used for design research').option('--login', 'open a browser to log in to Pinterest and save the session')
  .action(async (o) => {
    const api = await loadResearch();
    const p = join(buildDir('_sessions'), 'pinterest.json');
    if (o.login) { console.log('A browser will open. Log in to Pinterest, then wait; the session is saved when the login page goes away.'); await api.pinterestLogin(p); console.log(`saved ${p}`); }
    else console.log(`Session file: ${p}. Run with --login to create or refresh it.`);
  });

program.parseAsync(process.argv)
  .catch((e) => { log.error((e as Error).message); process.exitCode = 1; })
  // Keep-alive sockets and browser handles can hold the event loop open after the work is done.
  .finally(() => process.exit(process.exitCode ?? 0));
