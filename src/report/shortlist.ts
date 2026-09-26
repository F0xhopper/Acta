import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScoring, OUT_DIR } from '../config.js';
import { fullLeads } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import { today } from '../util/dates.js';
import { displayUkPhone } from '../util/phone.js';
import { slugify } from '../util/slug.js';
import { card, CHANNEL_LABEL, countBy, csvCell, esc, groupExclusion, hook, link, mapsLink, nextAction, reasonsOf, reviewsText, siteCell, siteUrl, telLink } from './format.js';

export interface ShortlistOpts { query?: string; top?: number; minViability?: number; tiers?: string[]; outDir?: string }

export function runOutDir(query?: string): string {
  const dir = join(OUT_DIR, `${today()}-${query ? slugify(query) : 'all'}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function selectShortlist(opts: ShortlistOpts): FullLead[] {
  const scoring = loadScoring();
  const tiers = opts.tiers?.length ? opts.tiers : ['A', 'B', 'C'];
  const rows = fullLeads({ query: opts.query, statuses: ['new'], tiers, minViability: opts.minViability ?? scoring.thresholds.min_viability });
  return rows.slice(0, Number.isFinite(opts.top) ? (opts.top as number) : 25);
}

const packRel = (r: FullLead) => `leads/${r.lead.slug}/notes.md`;
const shotRel = (r: FullLead) => (r.audit?.screenshot_mobile ? `leads/${r.lead.slug}/current-mobile.png` : null);

export function writeShortlist(opts: ShortlistOpts): { rows: FullLead[]; mdPath: string; csvPath: string; outDir: string } {
  const outDir = opts.outDir ?? runOutDir(opts.query);
  const rows = selectShortlist(opts);
  const all = fullLeads({ query: opts.query });
  const excluded = all.filter((r) => r.score?.tier === 'X');
  const tiers = countBy(rows, (r) => r.score?.tier ?? '?');
  const channels = countBy(rows, (r) => r.score?.channel ?? '?');
  const minV = opts.minViability ?? loadScoring().thresholds.min_viability;
  const top = rows.filter((r) => r.score?.tier === 'A' || r.score?.tier === 'B').slice(0, 10);

  const md: string[] = [
    `# Shortlist: ${opts.query ?? 'all searches'}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Leads you haven't contacted yet, viability ${minV} or more.`,
    '',
    '## At a glance',
    '',
    '| Found | Excluded | Ready to pitch | Tier A | Tier B | Tier C |',
    '|---|---|---|---|---|---|',
    `| ${all.length} | ${excluded.length} | ${rows.length} | ${tiers.A ?? 0} | ${tiers.B ?? 0} | ${tiers.C ?? 0} |`,
    '',
    `How to reach them: ${Object.entries(channels).map(([k, n]) => `${CHANNEL_LABEL[k] ?? k} ${n}`).join(' · ') || 'none'}`,
    '',
    '**Tier A** has no working website and an established business. **Tier B** has a live site with real problems. **Tier C** is worth a look but the signal is weaker.',
    '',
  ];

  if (top.length) {
    md.push('## Pitch these first', '');
    top.forEach((r, i) => md.push(...card(r, i + 1, packRel(r), shotRel(r)), ''));
  }

  md.push('## Full ranking', '',
    '| # | Tier | Score | Business | Website | Reviews | Channel | Phone | Why | Pack |',
    '|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r, i) => {
    md.push(`| ${i + 1} | ${r.score?.tier} | ${r.score?.total} | ${mapsLink(r)} | ${siteCell(r)} | ${reviewsText(r)} | ${CHANNEL_LABEL[r.score?.channel ?? ''] ?? ''} | ${telLink(r.lead.phone_e164)} | ${esc(reasonsOf(r, true).slice(0, 2).join('; '))} | ${link('open', packRel(r))} |`);
  });
  if (!rows.length) md.push('| | | | Nothing above the floor. Try a neighbouring area or a narrower trade. | | | | | | |');

  if (excluded.length) {
    const groups = countBy(excluded, (r) => groupExclusion(r.score?.excluded_reason ?? null));
    md.push('', '## Excluded', '',
      Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(' · '), '',
      `<details><summary>All ${excluded.length} excluded leads. Skim for anything that should be in.</summary>`, '',
      '| Business | Reason | Reviews | Website |', '|---|---|---|---|',
      ...excluded.map((r) => `| ${mapsLink(r)} | ${esc(r.score?.excluded_reason)} | ${reviewsText(r)} | ${siteCell(r)} |`),
      '', '</details>');
  }

  const header = ['rank', 'tier', 'score', 'opportunity', 'viability', 'name', 'category', 'area', 'rating', 'reviews', 'website_status', 'entity', 'channel', 'phone', 'hook', 'why', 'next_step', 'maps_url', 'website_url', 'pack', 'slug'];
  const csv = [header.join(',')];
  rows.forEach((r, i) => csv.push([
    i + 1, r.score?.tier, r.score?.total, r.score?.opportunity, r.score?.viability, r.lead.name, r.lead.category_key, r.lead.area, r.lead.rating, r.lead.review_count ?? 0,
    r.audit?.website_status, r.ch?.match_confidence === 'high' ? 'ltd' : 'unknown', r.score?.channel, displayUkPhone(r.lead.phone_e164), hook(r),
    reasonsOf(r, true).join('; '), nextAction(r), r.lead.google_maps_url, siteUrl(r), packRel(r), r.lead.slug,
  ].map(csvCell).join(',')));

  const mdPath = join(outDir, 'shortlist.md');
  const csvPath = join(outDir, 'shortlist.csv');
  writeFileSync(mdPath, md.join('\n') + '\n');
  writeFileSync(csvPath, csv.join('\n') + '\n');
  return { rows, mdPath, csvPath, outDir };
}
