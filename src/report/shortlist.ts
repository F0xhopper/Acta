import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScoring, OUT_DIR } from '../config.js';
import { fullLeads } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import { today } from '../util/dates.js';
import { displayUkPhone } from '../util/phone.js';
import { slugify } from '../util/slug.js';

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

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function writeShortlist(opts: ShortlistOpts): { rows: FullLead[]; mdPath: string; csvPath: string; outDir: string } {
  const outDir = opts.outDir ?? runOutDir(opts.query);
  const rows = selectShortlist(opts);
  const header = ['rank', 'tier', 'name', 'category', 'area', 'reviews', 'rating', 'site', 'opp', 'via', 'total', 'entity', 'channel', 'phone', 'reasons', 'pack'];
  const md: string[] = [
    `# Shortlist${opts.query ? `: ${opts.query}` : ''}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. ${rows.length} leads, status new only, viability ≥ ${opts.minViability ?? loadScoring().thresholds.min_viability}.`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  const csv: string[] = [[...header, 'maps_url', 'website_url', 'slug'].join(',')];
  rows.forEach((r, i) => {
    const reasons: string[] = r.score ? JSON.parse(r.score.reasons_json) : [];
    const entity = r.ch?.match_confidence === 'high' ? 'ltd' : 'unknown';
    const cells = [
      i + 1, r.score?.tier ?? '', r.lead.name, r.lead.category_key, r.lead.area, r.lead.review_count ?? 0, r.lead.rating ?? '',
      r.audit?.website_status ?? '', r.score?.opportunity ?? '', r.score?.viability ?? '', r.score?.total ?? '', entity, r.score?.channel ?? '',
      displayUkPhone(r.lead.phone_e164), reasons.slice(0, 3).join('; '), `leads/${r.lead.slug}/notes.md`,
    ];
    md.push(`| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
    csv.push([...cells, r.lead.google_maps_url, r.lead.website_url, r.lead.slug].map(csvCell).join(','));
  });
  const mdPath = join(outDir, 'shortlist.md');
  const csvPath = join(outDir, 'shortlist.csv');
  writeFileSync(mdPath, md.join('\n') + '\n');
  writeFileSync(csvPath, csv.join('\n') + '\n');
  return { rows, mdPath, csvPath, outDir };
}
