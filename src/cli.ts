import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { envInt, findCategory, loadCategories } from './config.js';
import { finishRun, fullLeads, getFullLead, setCategoryForQuery, startRun } from './db/queries.js';
import { discover } from './discover/index.js';
import { enrichEntities } from './discover/entity.js';
import { findEmails } from './loop/emails.js';
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
import { observations } from './sweep/queries.js';
import { leagues } from './sweep/opportunity.js';
import { runLeads } from './loop/leads.js';
import { suggestions } from './pick/suggest.js';
import { planSweep } from './sweep/plan.js';
import { loadSweep } from './sweep/config.js';
import { autoPick, explain, pickManual, pickedQueue, unpick } from './pick/index.js';
import { runWeek } from './loop/week.js';
import { runDay } from './loop/day.js';
import { installSchedule, scheduleStatus, uninstallSchedule } from './loop/schedule.js';
import { doctor, formatDoctor } from './doctor.js';
import { loadAutomation, OFF_HINT, setAutomation } from './loop/automation.js';

const program = new Command();
program.name('pipeline').description('Find local businesses that need a website, audit them, score them, shortlist them.');
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
  .option('--any-postcode', "keep results outside the market's postcode areas")
  .option('--variants', "also search the category's alternative terms (e.g. heating engineer, boiler repair)")
  .action(async (query: string, o) => {
    const r = await discover(query, { pages: Number(o.pages), dryRun: o.dryRun, anyPostcode: o.anyPostcode, budget: budget(), variants: o.variants });
    console.log(JSON.stringify({ query: r.parsed.raw, textQuery: r.parsed.textQuery, category: r.parsed.categoryKey, area: r.parsed.area, found: r.found, inserted: r.inserted, updated: r.updated, skipped: r.skipped, chains: r.chains }, null, 2));
  });

program.command('audit').description('Classify and audit websites for leads')
  .option('--query <q>').option('--slug <slug>').option('--force', 're-audit even if fresh')
  .option('--no-psi', 'skip PageSpeed Insights').option('--no-screenshots', 'skip Playwright screenshots').option('--dry-run')
  .action(async (o) => { console.log(JSON.stringify(await auditMany({ query: o.query, slug: o.slug, force: o.force, psi: o.psi, screenshots: o.screenshots, dryRun: o.dryRun }), null, 2)); });

program.command('rescue').description('Dead and broken sites: the domain\'s registration state (RDAP) and the last archived copy (Wayback Machine), for the content score, the build and the pitch')
  .option('--query <q>').option('--force', 'look again even when checked in the last week')
  .action(async (o) => {
    const { rescueMany } = await import('./audit/index.js');
    console.log(JSON.stringify(await rescueMany({ query: o.query, force: o.force }), null, 2));
  });

program.command('entity').description('Match leads against Companies House')
  .option('--query <q>').option('--slug <slug>').option('--force').option('--medium', 'look again at medium matches (name agrees, postcode doesn\'t), which SIC codes can now settle').option('--dry-run')
  .action(async (o) => { console.log(JSON.stringify(await enrichEntities({ query: o.query, slug: o.slug, force: o.force, medium: o.medium, dryRun: o.dryRun }), null, 2)); });

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

program.command('run').description('discover + audit + entity + score + emails + shortlist + pack for one query or a file of queries')
  .argument('[query]').option('--file <path>', 'one query per line')
  .option('--top <n>', 'max shortlist rows', '25').option('--pages <n>', 'pages of 20 results, max 3', '3').option('--min-viability <n>').option('--tiers <list>')
  .option('--areas <group|list>', 'fan the trade across an area group from config/areas.yaml, or a comma list')
  .option('--variants', "also search the category's alternative terms in each area")
  .option('--no-psi').option('--no-screenshots').option('--reviews').option('--any-postcode').option('--dry-run')
  .option('--no-web-email', 'skip the open-web email search for this run')
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
      await findEmails({ query: d.parsed.raw, web: o.webEmail });
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
  from: o.from ? (String(o.from) as BuildOpts['from']) : undefined,
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
  .option('--from <step>', 'start at a step: gather, repo, research, agent, gate, push, deploy, evidence')
  .option('--dry-run', 'show the steps that would run')
  .action(async (business: string | undefined, o) => {
    if (o.picked) {
      // Builds paused at the usage limit go first: they carry on where they stopped.
      const paused = listBuilds({ states: ['awaiting_usage'] }).map((b) => ({ slug: b.slug }));
      const queue = [...paused, ...pickedQueue()].slice(0, Number(o.max));
      if (!queue.length) { console.log('Picked queue is empty. Run: pnpm pipeline pick --auto'); return; }
      const perDay = envInt('BUILD_MAX_PER_DAY', 10);
      for (const q of queue.slice(0, perDay)) {
        const r = await buildLead(q.slug, buildOpts(o, budget()));
        printOutcome(r);
        if (r.error) process.exitCode = 1;
        if (r.state === 'awaiting_usage') { console.log('Stopped the queue: Claude usage is at the limit. Paused builds carry on in the next run.'); break; }
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
    if (!loadAutomation().sweep && !o.dryRun) { console.error(`The automatic sweep is off. ${OFF_HINT}`); process.exitCode = 1; return; }
    const r = await runSweep({ dryRun: o.dryRun, budget: o.budget ? Number(o.budget) : undefined });
    console.log(`${o.dryRun ? 'Would run' : 'Ran'} ${r.plan.run.length} searches, ${r.plan.estimatedRequests}/${r.plan.budget} requests${r.stoppedEarly ? `, stopped early: ${r.stoppedEarly}` : ''}`);
    for (const x of o.dryRun ? r.plan.run.map((p) => ({ query: p.query, found: p.cost, inserted: 0 })) : r.ran) console.log(`  ${x.query}${o.dryRun ? ` (${x.found} requests)` : `: ${x.found} found, ${x.inserted} new`}`);
    if (r.plan.skipped.length) { console.log(`Skipped ${r.plan.skipped.length}:`); r.plan.skipped.slice(0, 12).forEach((x) => console.log(`  ${x.query}: ${x.why}`)); }
    if (!o.dryRun) { const y = updateYields(); if (y.retired.length) console.log(`Retired: ${y.retired.join(', ')}`); }
  });

program.command('searches').description('Every search the sweep could run, best first, with what it is expected to find and why')
  .option('--top <n>', 'rows', '30').option('--all', 'every row')
  .action((o) => {
    const states = sweepStates();
    const { trades, areas } = leagues(observations());
    console.log(`Best trades so far (good per 10 found): ${trades.slice(0, 6).map((t) => `${t.key} ${t.per10} (${t.found})`).join(', ') || 'no data yet'}`);
    console.log(`Best areas so far: ${areas.slice(0, 6).map((a) => `${a.key} ${a.per10} (${a.found})`).join(', ') || 'no data yet'}\n`);
    for (const s of o.all ? states : states.slice(0, Number(o.top))) {
      console.log(`${((s.rate ?? 0) * 10).toFixed(1).padStart(5)} per 10  ${s.retired ? 'RETIRED ' : ''}${s.query}${s.runs ? `  (run ${s.runs}x, last ${s.lastRunAt?.slice(0, 10)})` : ''}`);
      console.log(`             ${s.why?.join('; ')}`);
    }
    const plan = planSweep(states, loadSweep());
    console.log(`\n${states.length} possible searches. Next sweep would run ${plan.run.length} (${plan.estimatedRequests} requests): ${plan.run.map((r) => r.query).join(' | ')}`);
  });

program.command('leads').description('The daily lead run: the best searches from the opportunity map, then audit, Companies House, score and new suggestions. Writes out/NEW-LEADS.md')
  .option('--dry-run', 'show which searches it would run').option('--budget <n>', 'override the Places request budget')
  .option('--once', 'run now even when automatic finding is switched off')
  .action(async (o) => {
    if (!loadAutomation().sweep && !o.dryRun && !o.once) { console.error(`Automatic lead finding is off. ${OFF_HINT}`); process.exitCode = 1; return; }
    console.log((await runLeads({ dryRun: o.dryRun, budget: o.budget ? Number(o.budget) : undefined })).text);
  });

program.command('suggest').description('The leads that pass every gate in config/pick.yaml, ranked by grade, then the near misses with what each is missing')
  .option('--top <n>', 'rows', '12').option('--gates', 'show every gate and grade part')
  .action((o) => {
    const list = suggestions({ limit: Number(o.top) });
    if (!list.length) { console.log('Nothing passes or nearly passes. Run some searches, or loosen `gates` in config/pick.yaml.'); return; }
    const passed = list.filter((s) => s.verdict === 'pass');
    console.log(passed.length ? `${passed.length} pass:` : 'Nothing passes yet.');
    list.forEach((s, i) => {
      if (s.verdict === 'near' && (i === 0 || list[i - 1].verdict === 'pass')) console.log('\nNear misses, one gate short:');
      console.log(`${String(i + 1).padStart(2)}. ${s.isNew ? 'NEW ' : ''}${s.name} (${s.slug}) grade ${s.grade}${s.pickScore !== s.grade ? `, pick ${s.pickScore}` : ''}, ${s.categoryLabel}, ${s.area}`);
      console.log(`    ${s.hook}`);
      if (s.verdict === 'near') console.log(`    missing: ${s.gates.filter((g) => !g.pass).map((g) => `${g.label}: ${g.detail}`).join('; ')}`);
      if (o.gates) {
        for (const g of s.gates) console.log(`    ${g.pass ? 'pass' : 'FAIL'}  ${g.label}: ${g.detail}`);
        for (const p of s.parts) console.log(`    ${String(p.points).padStart(4)}/${p.max}  ${p.label}: ${p.detail}`);
      }
    });
  });

program.command('pick').description('Pick leads to build: by slug, or --auto for the rule in config/pick.yaml')
  .argument('[slugs...]').option('--auto', 'apply the rule').option('--max <n>').option('--dry-run').option('--no-recheck', 'skip the fresh look at each site before picking')
  .action(async (slugs: string[], o) => {
    if (o.auto && !loadAutomation().autoPick) { console.error(`The auto-picker is off. ${OFF_HINT}`); process.exitCode = 1; return; }
    if (o.auto) { console.log(explain(await autoPick({ max: o.max ? Number(o.max) : undefined, dryRun: o.dryRun, recheck: o.recheck }))); return; }
    if (!slugs.length) { console.error('Give slugs, or --auto'); process.exitCode = 1; return; }
    const r = pickManual(slugs);
    console.log(`picked: ${r.ok.join(', ') || 'none'}${r.missing.length ? `\nnot found: ${r.missing.join(', ')}` : ''}`);
  });

program.command('unpick').argument('<slug>').action((slug: string) => { console.log(unpick(slug)); });

program.command('call').description('The call before the build (checkpoints.call in config/build.yaml): show the script, or record what they said')
  .argument('<slug>').argument('[answer]', 'yes or no; omit to print the script').option('--note <text>', 'what they said')
  .action(async (slug: string, answer: string | undefined, o) => {
    const { recordCallOutcome } = await import('./pick/index.js');
    const { callScript, needsCall } = await import('./pick/call.js');
    const full = getFullLead(slug); if (!full) { console.error(`No lead ${slug}`); process.exitCode = 1; return; }
    if (!answer) {
      if (!needsCall(full)) { console.log(`${full.lead.name} can be cold emailed: no call needed before the build.`); return; }
      console.log(callScript(full).lines.join('\n')); return;
    }
    if (answer !== 'yes' && answer !== 'no') { console.error('Answer yes or no'); process.exitCode = 1; return; }
    console.log(recordCallOutcome(slug, answer, o.note ?? null));
  });

program.command('week').description('The Sunday job: re-audit, score and refresh the leaderboard (plus auto-pick when switched on in config/build.yaml). Writes out/REVIEW.md')
  .option('--dry-run').option('--max <n>', 'picks')
  .action(async (o) => { console.log(await runWeek({ dryRun: o.dryRun, max: o.max ? Number(o.max) : undefined })); });

program.command('day').description('The weekday job: tear down stale previews, refresh the leaderboard, list the review queue')
  .option('--dry-run').action(async (o) => { console.log(await runDay({ dryRun: o.dryRun })); });

program.command('autopilot').description('The pipeline running by itself while the Acta server is up: picks the best passer, builds it, tells you when it is ready (config/build.yaml automation.autopilot)')
  .argument('[action]', 'status | on | off', 'status')
  .action(async (action: string) => {
    if (!['status', 'on', 'off'].includes(action)) { console.error('Say status, on or off'); process.exitCode = 1; return; }
    const { autopilotStatus, formatAutopilot } = await import('./loop/autopilot.js');
    const { pokeServer } = await import('./ui/poke.js');
    let s: Awaited<ReturnType<typeof autopilotStatus>> | null = null;
    if (action !== 'status') {
      setAutomation('autopilot', action === 'on');
      // The running server acts on the switch now (and reports its own reason); without one, the flag alone is enough.
      s = await pokeServer<Awaited<ReturnType<typeof autopilotStatus>>>('POST', '/api/autopilot', { on: action === 'on' });
    } else s = await pokeServer<Awaited<ReturnType<typeof autopilotStatus>>>('GET', '/api/autopilot');
    s ??= await autopilotStatus();
    console.log(formatAutopilot(s));
    if (action === 'on') console.log(s.scheduled ? 'The always-on server is on it now.' : 'It runs while `pnpm ui` is open. To keep it running whenever the Mac is on: pnpm pipeline schedule install');
    if (action === 'off') console.log('Switched off. A build already running finishes (cancel it from Activity if you want it stopped); paused builds still carry on when usage resets.');
  });

program.command('schedule').description('Install, remove or show the launchd jobs. Autopilot on: the always-on server (ui). Off: leads (daily), week, builds and day').argument('<action>', 'install | uninstall | status')
  .option('--jobs <list>', 'install only these: ui,leads,week,day,builds')
  .action(async (action: string, o) => {
    const out = action === 'install' ? await installSchedule(o.jobs ? String(o.jobs).split(',') : undefined) : action === 'uninstall' ? await uninstallSchedule() : await scheduleStatus();
    out.forEach((l) => console.log(`  ${l}`));
  });

program.command('doctor').description('Check every prerequisite the pipeline needs').action(async () => {
  const checks = await doctor();
  console.log(formatDoctor(checks));
  if (!checks.filter((c) => c.required).every((c) => c.ok)) process.exitCode = 1;
});

program.command('deploy-smoke').description('Prove the Vercel path: deploy a throwaway starter site, verify the noindex header, remove it')
  .option('--keep', 'leave the smoke project and folder in place')
  .action(async (o) => {
    const { deploySmoke } = await import('./build/smoke.js');
    const r = await deploySmoke({ keep: o.keep });
    r.notes.forEach((n) => console.log(`  ${n}`));
    console.log(r.ok ? `deploy smoke PASSED: ${r.url}` : 'deploy smoke FAILED');
    if (!r.ok) process.exitCode = 1;
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

// ---------- checkpoints, screenshots and the UI ----------

program.command('photos').description('Sort the gathered photos for a build paused at the photo checkpoint, then continue it')
  .argument('<slug>')
  .option('--drop <list>', 'comma list of photo numbers to drop (the rest are kept)').option('--hero <n>', 'the hero photo')
  .option('--skip', 'keep the automatic choice').option('--no-continue', 'save only, do not continue the build')
  .action(async (slug: string, o) => {
    const { listPhotos, saveCuration } = await import('./build/checkpoints.js');
    const full = getFullLead(slug); if (!full) { console.error(`No lead ${slug}`); process.exitCode = 1; return; }
    const b = getBuild(full.lead.id); const dir = b?.repo_dir ?? join(process.cwd(), 'sites', slug);
    const photos = listPhotos(dir).filter((p) => !p.dropped);
    if (!o.drop && !o.hero && !o.skip) { photos.forEach((p, i) => console.log(`  ${i + 1}. ${p.path} (${p.source}, ${p.width}x${p.height})`)); console.log('Then: pnpm pipeline photos <slug> --drop 3,5 --hero 1'); return; }
    const nums = (s?: string) => new Set((s ?? '').split(',').map((x) => Number(x.trim())).filter(Boolean));
    const drop = nums(o.drop), hero = Number(o.hero ?? 0);
    const choices = photos.map((p, i) => ({ path: p.path, choice: (i + 1 === hero ? 'hero' : drop.has(i + 1) ? 'drop' : 'keep') as 'keep' | 'drop' | 'hero' }));
    await saveCuration(dir, choices, { apply: b?.state === 'awaiting_photos', skipped: !!o.skip });
    console.log(`Saved: ${choices.filter((c) => c.choice !== 'drop').length} kept, ${choices.filter((c) => c.choice === 'drop').length} dropped`);
    if (o.continue !== false && b?.state === 'awaiting_photos') printOutcome(await buildLead(slug, buildOpts({}, budget())));
  });

program.command('concept').description('Choose one of the three concepts for a build paused at the concept checkpoint, then continue it')
  .argument('<slug>').option('--choose <n>', 'the concept number; omit to keep the agent\'s pick').option('--note <text>', 'a note for the designer')
  .option('--no-continue', 'save only, do not continue the build')
  .action(async (slug: string, o) => {
    const { chooseConcept, parseConcepts, readConceptsMd } = await import('./build/checkpoints.js');
    const full = getFullLead(slug); if (!full) { console.error(`No lead ${slug}`); process.exitCode = 1; return; }
    const b = getBuild(full.lead.id); const dir = b?.repo_dir ?? join(process.cwd(), 'sites', slug);
    if (!o.choose && !o.note && process.argv.length <= 4) { for (const c of parseConcepts(readConceptsMd(dir))) console.log(`  ${c.index}. ${c.name}: ${c.idea.slice(0, 120)}`); return; }
    const r = await chooseConcept(dir, o.choose ? Number(o.choose) : null, o.note ?? null);
    console.log(`Chose concept ${r.index}: ${r.name}`);
    if (o.continue !== false && b?.state === 'awaiting_concept') printOutcome(await buildLead(slug, buildOpts({}, budget())));
  });

program.command('shots').description('Full-page screenshots of every page of a built site, on phone, tablet and desktop, for the review studio').argument('<slug>')
  .action(async (slug: string) => {
    const { takePageShots } = await import('./ui/shots.js');
    const r = await takePageShots(slug);
    console.log(r.ok ? `${r.pages} pages captured` : `No screenshots: ${r.reason}`);
    if (!r.ok) process.exitCode = 1;
  });

program.command('ui').description('Start the Acta UI on http://127.0.0.1:4321').option('--port <n>', 'port', '4321')
  .action(async (o) => {
    const { startServer } = await import('./ui/server.js');
    const server = startServer(Number(o.port));
    // The CLI exits when a command's promise settles, so the server's command waits until it's stopped.
    await new Promise<void>((resolve) => { for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { server.close(); resolve(); }); });
  });

// ---------- reach: can we get a pitch to them? ----------

program.command('emails').description("Find emails and socials on each lead's own website, looking for that website by name when Google links none")
  .option('--tiers <list>', 'e.g. A,B,C', 'A,B,C').option('--all', 'look again at leads already searched').option('--no-search', "don't look for unlisted websites")
  .action(async (o) => {
    const { findContacts } = await import('./audit/index.js');
    const { closeBrowser } = await import('./audit/screenshot.js');
    const leads = fullLeads({ tiers: tiersOf(o.tiers) }).filter((f) => o.all || !f.lead.site_search_at || ['live', 'broken'].includes(f.audit?.website_status ?? ''));
    console.log(`Looking at ${leads.length} leads...`);
    let sites = 0, withEmail = 0;
    try {
      for (const f of leads) {
        const r = await findContacts(f, { searchSite: o.search });
        if (r.foundSite) sites++;
        if (r.contacts.emails.length) withEmail++;
        if (r.foundSite || r.contacts.emails.length) console.log(`  ${f.lead.name}: ${[r.foundSite ? `site ${r.foundSite}` : null, ...r.contacts.emails].filter(Boolean).join(', ')}`);
      }
    } finally { await closeBrowser(); }
    scoreAll({});
    console.log(`${withEmail} of ${leads.length} with an email, ${sites} unlisted websites found.`);
  });

program.command('web-emails').description("Search the open web for an email when their own site has none (booking sites, directories); checked against the page it's on")
  .argument('[slug]', 'one lead; omit for the queue').option('--tiers <list>', 'e.g. A,B,C', 'A,B,C').option('--limit <n>', 'leads to search', '20').option('--all', 'search leads already searched again')
  .action(async (slug: string | undefined, o) => {
    const { searchAndStoreWebEmail, webEmailQueue } = await import('./audit/web-email.js');
    const { reachOf } = await import('./score/reach.js');
    const { closeBrowser } = await import('./audit/screenshot.js');
    const { readUsage, overLimit, usageThreshold } = await import('./build/usage.js');
    const one = slug ? getFullLead(slug) : null;
    if (slug && !one) { console.error(`No lead ${slug}`); process.exitCode = 1; return; }
    const leads = one ? [one] : webEmailQueue(fullLeads({ tiers: tiersOf(o.tiers) }), (f) => !!reachOf(f, findCategory(f.lead.category_key)).email, { again: o.all }).slice(0, Number(o.limit));
    console.log(`Searching the web for ${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}...`);
    let found = 0;
    try {
      for (const [i, f] of leads.entries()) {
        if (i % 5 === 0) { const u = await readUsage().catch(() => null); const over = u ? overLimit(u, usageThreshold()) : null; if (over) { console.log(`Stopped: Claude usage ${over}.`); break; } }
        const r = await searchAndStoreWebEmail(f);
        if (r.email) found++;
        console.log(`  ${f.lead.name}: ${r.email ? `${r.email} (${r.note})` : r.note}`);
      }
    } finally { await closeBrowser(); }
    scoreAll({});
    console.log(`${found} of ${leads.length} emails found and checked.`);
  });

program.command('reach').description('How each lead can be pitched (email, message after a call, call only, visit only), checked before building')
  .option('--tiers <list>', 'e.g. A,B', 'A,B').option('--refresh', 're-read their websites for emails and social links first')
  .action(async (o) => {
    const { reachOf, REACH_LABEL } = await import('./score/reach.js');
    const { refreshContacts } = await import('./audit/index.js');
    const leads = fullLeads({ tiers: tiersOf(o.tiers) });
    if (o.refresh) {
      const todo = leads.filter((f) => f.audit && ['live', 'broken'].includes(f.audit.website_status));
      console.log(`Reading ${todo.length} websites for contact details...`);
      for (const f of todo) { const c = await refreshContacts(f.lead, f.audit ?? undefined); if (c.emails.length || c.socials.length) console.log(`  ${f.lead.name}: ${[...c.emails, ...c.socials.map((x) => x.kind)].join(', ')}`); }
    }
    const fresh = fullLeads({ tiers: tiersOf(o.tiers) });
    const counts: Record<string, number> = {};
    for (const f of fresh) {
      const r = reachOf(f, findCategory(f.lead.category_key));
      counts[r.level] = (counts[r.level] ?? 0) + 1;
      console.log(`${REACH_LABEL[r.level].padEnd(22)} ${f.lead.name.slice(0, 40).padEnd(41)} ${r.summary}`);
    }
    console.log(`\n${Object.entries(counts).map(([k, n]) => `${REACH_LABEL[k as keyof typeof REACH_LABEL]}: ${n}`).join(' · ')}`);
  });

program.command('contact').description('Save an email address you found yourself for a lead').argument('<slug>').argument('[email]', 'omit to clear')
  .action(async (slug: string, email?: string) => {
    const { openDb } = await import('./db/index.js');
    const full = getFullLead(slug); if (!full) { console.error(`No lead ${slug}`); process.exitCode = 1; return; }
    openDb().prepare('UPDATE leads SET manual_email = ? WHERE id = ?').run(email?.trim().toLowerCase() || null, full.lead.id);
    console.log(email ? `Saved ${email} for ${full.lead.name}` : `Cleared the email for ${full.lead.name}`);
  });

// ---------- outreach ----------

const outreach = program.command('outreach').description('Send pitches and follow-ups, check replies and the sending domain (config/outreach.yaml)');
outreach.command('status').description('How sending is set up, the warm-up limit, DNS, and follow-ups due').action(async () => {
  const { outreachStatus, dueFollowUps } = await import('./outreach/index.js');
  const s = await outreachStatus();
  console.log(`Sending:   ${s.transportLabel}${s.from ? ` (from ${s.from})` : ''}`);
  console.log(`Today:     ${s.cap.sentToday} of ${s.cap.today} emails (warm-up week ${s.cap.warmupWeek})`);
  for (const c of s.dns ?? []) console.log(`DNS:       ${c.ok ? 'ok  ' : 'MISSING'} ${c.name}: ${c.detail}`);
  for (const p of s.problems) console.log(`Note:      ${p}`);
  const due = dueFollowUps();
  console.log(`Follow-ups due: ${due.length}${due.length ? `\n${due.map((f) => `  ${f.name}: follow-up ${f.n} (${f.channel})`).join('\n')}` : ''}`);
  console.log(`Replies:   ${s.replies.check ? `checked ${s.replies.lastCheckedAt ?? 'never'}${s.replies.lastError ? ` (${s.replies.lastError})` : ''}` : 'detection off'}`);
});
outreach.command('check').description('Check the sending domain\'s MX, SPF, DKIM and DMARC records').action(async () => {
  const { dnsChecks } = await import('./outreach/index.js');
  const checks = await dnsChecks(undefined, true);
  for (const c of checks) console.log(`${c.ok ? 'ok     ' : 'MISSING'} ${c.name}: ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
});
outreach.command('send').description('Send the approved pitch email for a business').argument('<slug>').option('--override', 'send even if today\'s warm-up limit is used')
  .action(async (slug: string, o) => {
    const { sendPitch } = await import('./outreach/index.js');
    const { markSent } = await import('./delivery/index.js');
    const m = await sendPitch(slug, { override: o.override });
    markSent(slug, 'email');
    console.log(m.status === 'written' ? 'Test mode: written to out/outbox' : `Sent to ${m.to_addr}`);
  });
outreach.command('followups').description('List follow-ups due; --send sends the due email ones within today\'s limit').option('--send')
  .action(async (o) => {
    const { dueFollowUps, doFollowUp, capState } = await import('./outreach/index.js');
    const due = dueFollowUps();
    if (!due.length) { console.log('No follow-ups due.'); return; }
    for (const f of due) {
      if (o.send && f.canEmail && capState().left > 0) {
        try { await doFollowUp(f.slug, { mode: 'send' }); console.log(`sent     ${f.name}: follow-up ${f.n}`); } catch (e) { console.log(`not sent ${f.name}: ${(e as Error).message}`); }
      } else console.log(`due      ${f.name}: follow-up ${f.n} (${f.channel})${f.canEmail ? '' : ' - by hand'}`);
    }
  });
outreach.command('opens').description('Read how many times each preview has been opened (needs UPSTASH_REDIS_REST_URL and _TOKEN in .env)').argument('[slugs...]')
  .action(async (slugs: string[]) => {
    const { refreshOpens, opensLine } = await import('./outreach/opens.js');
    const r = await refreshOpens({ slugs });
    if (r.note) { console.log(r.note); return; }
    for (const row of r.rows.sort((a, b) => b.opens - a.opens)) console.log(`${String(row.opens).padStart(4)}  ${row.name.slice(0, 40).padEnd(41)} ${opensLine(row, true)}`);
    if (!r.rows.length) console.log('No deployed previews to check.');
    for (const e of r.errors) console.log(`error  ${e}`);
  });
outreach.command('stats').description('What is working: pitches by trade, channel and hook, with opens, replies and wins').action(async () => {
  const { outreachStats, formatStats } = await import('./outreach/stats.js');
  console.log(formatStats(outreachStats()));
});
outreach.command('replies').description('Check the inbox through Proton Mail Bridge for replies').action(async () => {
  const { checkReplies } = await import('./outreach/replies.js');
  const r = await checkReplies();
  console.log(r.error ?? `${r.checked} new messages, ${r.matched.length} from businesses: ${r.matched.map((m) => `${m.name} (${m.kind})`).join(', ') || 'none'}`);
  if (r.error) process.exitCode = 1;
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
