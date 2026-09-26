import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { OUT_DIR } from '../config.js';
import { fullLeads } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import { displayUkPhone } from '../util/phone.js';
import { slugify } from '../util/slug.js';
import { card, CHANNEL_LABEL, countBy, csvCell, esc, findPack, hook, link, mapsLink, nextAction, reasonsOf, reviewsText, siteCell, siteUrl, telLink } from './format.js';

const IN_PROGRESS = ['shortlisted', 'building', 'preview_ready', 'contacted', 'followup_1', 'followup_2', 'replied'];
const STATUS_TEXT: Record<string, string> = {
  shortlisted: 'Picked', building: 'Building', preview_ready: 'Preview ready', contacted: 'Contacted', followup_1: 'Followed up once',
  followup_2: 'Followed up twice', replied: 'Replied', won: 'Won', lost: 'Lost', do_not_contact: 'Do not contact',
};

function latestRunDir(query: string): string | null {
  if (!existsSync(OUT_DIR)) return null;
  const suffix = `-${slugify(query)}`;
  return readdirSync(OUT_DIR).filter((d) => d.endsWith(suffix)).sort().reverse()[0] ?? null;
}

function packLinks(r: FullLead): { pack: string | null; shot: string | null } {
  const p = findPack(r.lead.slug);
  if (!p) return { pack: null, shot: null };
  const shot = join(dirname(p), 'current-mobile.png');
  return { pack: relative(OUT_DIR, p), shot: existsSync(shot) ? relative(OUT_DIR, shot) : null };
}

export function writeLeaderboard(top = 50): { mdPath: string; csvPath: string; ready: FullLead[] } {
  mkdirSync(OUT_DIR, { recursive: true });
  const all = fullLeads();
  const ready = all.filter((r) => ['A', 'B', 'C'].includes(r.score?.tier ?? '') && r.pipeline.status === 'new');
  const shown = ready.slice(0, top);
  const inProgress = all.filter((r) => IN_PROGRESS.includes(r.pipeline.status)).sort((a, b) => (b.pipeline.updated_at ?? '').localeCompare(a.pipeline.updated_at ?? ''));
  const closed = countBy(all.filter((r) => ['won', 'lost', 'do_not_contact'].includes(r.pipeline.status)), (r) => r.pipeline.status);
  const wonNames = all.filter((r) => r.pipeline.status === 'won').map((r) => r.lead.name);
  const tiers = countBy(ready, (r) => r.score!.tier);
  const queries = [...new Set(all.map((r) => r.lead.source_query))];

  const md: string[] = [
    '# Acta leaderboard',
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Every lead across every search, ranked. Updates on every run and every status change.`,
    '',
    '| Ready to pitch | Tier A | Tier B | Tier C | In progress | Won | Searches run |',
    '|---|---|---|---|---|---|---|',
    `| ${ready.length} | ${tiers.A ?? 0} | ${tiers.B ?? 0} | ${tiers.C ?? 0} | ${inProgress.length} | ${closed.won ?? 0} | ${queries.length} |`,
    '',
  ];

  if (inProgress.length) {
    md.push('## In progress', '', '| Business | Status | Channel | Phone | Last touch | Latest note | Pack |', '|---|---|---|---|---|---|---|');
    for (const r of inProgress) {
      const note = (r.pipeline.notes ?? '').split('\n').filter(Boolean).pop() ?? '';
      const { pack } = packLinks(r);
      md.push(`| ${mapsLink(r)} | ${STATUS_TEXT[r.pipeline.status] ?? r.pipeline.status} | ${CHANNEL_LABEL[r.score?.channel ?? ''] ?? ''} | ${telLink(r.lead.phone_e164)} | ${(r.pipeline.last_touch_at ?? r.pipeline.updated_at ?? '').slice(0, 10)} | ${esc(note)} | ${pack ? link('open', pack) : ''} |`);
    }
    md.push('');
  }

  const cards = shown.filter((r) => r.score?.tier === 'A' || r.score?.tier === 'B').slice(0, 10);
  if (cards.length) {
    md.push('## Pitch next', '');
    cards.forEach((r, i) => { const { pack, shot } = packLinks(r); md.push(...card(r, i + 1, pack, shot), `| Search | ${esc(r.lead.source_query)} |`, ''); });
  }

  md.push(`## All ready to pitch${ready.length > top ? ` (top ${top} of ${ready.length})` : ''}`, '',
    '| # | Tier | Score | Business | Search | Website | Reviews | Channel | Phone | Why | Pack |',
    '|---|---|---|---|---|---|---|---|---|---|---|');
  shown.forEach((r, i) => {
    const { pack } = packLinks(r);
    md.push(`| ${i + 1} | ${r.score?.tier} | ${r.score?.total} | ${mapsLink(r)} | ${esc(r.lead.source_query)} | ${siteCell(r)} | ${reviewsText(r)} | ${CHANNEL_LABEL[r.score?.channel ?? ''] ?? ''} | ${telLink(r.lead.phone_e164)} | ${esc(reasonsOf(r, true).slice(0, 2).join('; '))} | ${pack ? link('open', pack) : ''} |`);
  });
  md.push('');

  const bySearch = queries.map((q) => {
    const rows = all.filter((r) => r.lead.source_query === q);
    const t = countBy(rows.filter((r) => r.pipeline.status === 'new'), (r) => r.score?.tier ?? '?');
    const contacted = rows.filter((r) => !['new', 'shortlisted', 'building', 'preview_ready'].includes(r.pipeline.status)).length;
    const won = rows.filter((r) => r.pipeline.status === 'won').length;
    return { q, found: rows.length, a: t.A ?? 0, b: t.B ?? 0, c: t.C ?? 0, contacted, won, dir: latestRunDir(q) };
  }).sort((x, y) => (y.a + y.b) / Math.max(y.found, 1) - (x.a + x.b) / Math.max(x.found, 1));
  md.push('## Searches ranked by yield', '', 'Yield is tier A plus tier B per ten businesses found. Higher means a better area and trade to work.', '',
    '| Search | Found | A | B | C | Yield | Contacted | Won | Shortlist |', '|---|---|---|---|---|---|---|---|---|',
    ...bySearch.map((s) => `| ${esc(s.q)} | ${s.found} | ${s.a} | ${s.b} | ${s.c} | ${((10 * (s.a + s.b)) / Math.max(s.found, 1)).toFixed(1)} | ${s.contacted} | ${s.won} | ${s.dir ? link('open', `${s.dir}/shortlist.md`) : ''} |`), '');

  md.push('## Results', '', `Won ${closed.won ?? 0}${wonNames.length ? ` (${wonNames.map(esc).join(', ')})` : ''} · Lost ${closed.lost ?? 0} · Do not contact ${closed.do_not_contact ?? 0}`, '');

  const header = ['rank', 'tier', 'score', 'name', 'search', 'category', 'area', 'rating', 'reviews', 'website_status', 'channel', 'phone', 'hook', 'why', 'next_step', 'maps_url', 'website_url', 'slug'];
  const csv = [header.join(',')];
  ready.forEach((r, i) => csv.push([i + 1, r.score?.tier, r.score?.total, r.lead.name, r.lead.source_query, r.lead.category_key, r.lead.area, r.lead.rating, r.lead.review_count ?? 0,
    r.audit?.website_status, r.score?.channel, displayUkPhone(r.lead.phone_e164), hook(r), reasonsOf(r, true).join('; '), nextAction(r), r.lead.google_maps_url, siteUrl(r), r.lead.slug].map(csvCell).join(',')));

  const mdPath = join(OUT_DIR, 'LEADERBOARD.md');
  const csvPath = join(OUT_DIR, 'leaderboard.csv');
  writeFileSync(mdPath, md.join('\n') + '\n');
  writeFileSync(csvPath, csv.join('\n') + '\n');
  return { mdPath, csvPath, ready };
}
