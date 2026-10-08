/** Comments pinned on page screenshots, compiled into a review note with cropped images the agent can read. */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { DATA_DIR, ROOT } from '../config.js';
import { openDb } from '../db/index.js';
import { isoNow } from '../util/dates.js';
import type { Device, FeedbackItem, NewFeedback } from './api-types.js';
import { fileUrl } from './files.js';
import { routeSlug } from './shots.js';

interface Row { id: number; slug: string; page: string | null; device: string | null; x: number | null; y: number | null; text: string; crop_path: string | null; round: number | null; created_at: string; rule: number; resolved: string | null; carried_from: number | null }
const d = () => openDb();
const DEVICES: Device[] = ['mobile', 'tablet', 'desktop'];
const asDevice = (v: unknown): Device | null => (DEVICES.includes(v as Device) ? (v as Device) : null);
const clamp = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.max(0, Math.min(1, Number(v))));

const toItem = (r: Row): FeedbackItem => ({
  id: r.id, slug: r.slug, page: r.page, device: asDevice(r.device), x: r.x, y: r.y, text: r.text,
  cropUrl: r.crop_path ? fileUrl('site', r.slug, join(ROOT, 'sites', r.slug, r.crop_path)) : null,
  round: r.round, rule: r.rule === 1, resolved: r.resolved === 'fixed' || r.resolved === 'not_fixed' ? r.resolved : null, createdAt: r.created_at,
});
const row = (id: number) => d().prepare('SELECT * FROM feedback WHERE id = ?').get(id) as unknown as Row | undefined;

export function listFeedback(slug: string): FeedbackItem[] {
  return (d().prepare('SELECT * FROM feedback WHERE slug = ? ORDER BY round IS NOT NULL, round DESC, id').all(slug) as unknown as Row[]).map(toItem);
}

export function addFeedback(slug: string, f: NewFeedback): FeedbackItem {
  const text = String(f.text ?? '').trim();
  if (!text) throw new Error('A comment needs some text');
  const res = d().prepare('INSERT INTO feedback (slug, page, device, x, y, text, rule, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(slug, f.page ?? null, asDevice(f.device), clamp(f.x), clamp(f.y), text.slice(0, 4000), f.rule ? 1 : 0, isoNow());
  return toItem(row(Number(res.lastInsertRowid))!);
}

/**
 * Edit a comment. Text and position only while unsent; rule and resolved at any time.
 * Marking a sent comment "not fixed" copies it into the next round's draft, once.
 */
export function updateFeedback(id: number, patch: Partial<{ text: string; x: number; y: number; rule: boolean; resolved: 'fixed' | 'not_fixed' | null }>): FeedbackItem | null {
  const r = row(id);
  if (!r) return null;
  if (r.round === null) {
    if (typeof patch.text === 'string' && patch.text.trim()) d().prepare('UPDATE feedback SET text = ? WHERE id = ?').run(patch.text.trim().slice(0, 4000), id);
    if (patch.x !== undefined || patch.y !== undefined) d().prepare('UPDATE feedback SET x = ?, y = ? WHERE id = ?').run(clamp(patch.x ?? r.x), clamp(patch.y ?? r.y), id);
  }
  if (typeof patch.rule === 'boolean') d().prepare('UPDATE feedback SET rule = ? WHERE id = ?').run(patch.rule ? 1 : 0, id);
  if (patch.resolved !== undefined && r.round !== null) {
    const v = patch.resolved === 'fixed' || patch.resolved === 'not_fixed' ? patch.resolved : null;
    d().prepare('UPDATE feedback SET resolved = ? WHERE id = ?').run(v, id);
    const carried = d().prepare('SELECT id FROM feedback WHERE carried_from = ? AND round IS NULL').get(id) as { id: number } | undefined;
    if (v === 'not_fixed' && !carried) {
      d().prepare('INSERT INTO feedback (slug, page, device, x, y, text, rule, carried_from, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(r.slug, r.page, r.device, r.x, r.y, `Still not done from round ${r.round}: ${r.text.replace(/^Still not done from round \d+: /, '')}`, r.rule, id, isoNow());
    } else if (v !== 'not_fixed' && carried) {
      d().prepare('DELETE FROM feedback WHERE id = ?').run(carried.id);
    }
  }
  return toItem(row(id)!);
}

export function deleteFeedback(id: number): boolean {
  return Number(d().prepare('DELETE FROM feedback WHERE id = ? AND round IS NULL').run(id).changes) > 0;
}

export const sentRounds = (slug: string) => (d().prepare('SELECT MAX(round) r FROM feedback WHERE slug = ?').get(slug) as { r: number | null }).r ?? 0;
export const nextRound = (slug: string) => sentRounds(slug) + 1;
export const unsentCount = (slug: string) => (d().prepare('SELECT COUNT(*) n FROM feedback WHERE slug = ? AND round IS NULL').get(slug) as { n: number }).n;

/** The note the revise agent receives. Pure, so it can be tested. */
export function compileNote(round: number, items: { id: number; page: string | null; device: string | null; text: string; crop: string | null }[]): string {
  const pinned = items.filter((i) => i.page);
  const general = items.filter((i) => !i.page);
  const lines = [`# Review round ${round}`, '', 'Changes requested by the owner of this pipeline after looking at the site. Do every item. Each cropped image shows the exact spot with a red circle: open it with Read before changing anything.', ''];
  let n = 1;
  for (const i of pinned) lines.push(`${n++}. On ${i.page} (${i.device ?? 'mobile'})${i.crop ? `, near the point marked in ${i.crop}` : ''}: ${i.text}`);
  for (const i of general) lines.push(`${n++}. ${i.text}`);
  lines.push('', 'Keep the chosen concept, the brand and every fact. Re-run pnpm shots and pnpm gate, update acta/build-log.md with what changed, and commit.');
  return lines.join('\n');
}

/** Crop sizes per device, in screenshot pixels. Pure. */
export function cropBox(device: Device, W: number, H: number, x: number, y: number) {
  const size: Record<Device, [number, number]> = { mobile: [360, 360], tablet: [560, 420], desktop: [720, 480] };
  const cw = Math.min(W, size[device][0]), chh = Math.min(H, size[device][1]);
  const px = Math.round(x * W), py = Math.round(y * H);
  const left = Math.max(0, Math.min(W - cw, px - Math.round(cw / 2)));
  const top = Math.max(0, Math.min(H - chh, py - Math.round(chh / 2)));
  return { left, top, width: cw, height: chh, px, py };
}

/** Crop around each pinned point, mark it, compile the note, file pipeline rules. Returns the note and the round. Does not queue anything. */
export async function prepareRound(slug: string, name: string): Promise<{ round: number; note: string; notePath: string; count: number }> {
  const unsent = d().prepare('SELECT * FROM feedback WHERE slug = ? AND round IS NULL ORDER BY id').all(slug) as unknown as Row[];
  if (!unsent.length) throw new Error('No unsent comments for this site');
  const round = nextRound(slug);
  const siteDir = join(ROOT, 'sites', slug);
  const relDir = join('acta', 'review', `round-${round}`);
  mkdirSync(join(siteDir, relDir), { recursive: true });
  const compiled: { id: number; page: string | null; device: string | null; text: string; crop: string | null }[] = [];
  for (const r of unsent) {
    let crop: string | null = null;
    if (r.page && r.x !== null && r.y !== null) {
      const device = asDevice(r.device) ?? 'mobile';
      const shot = join(siteDir, 'acta', 'qa', 'pages', `${routeSlug(r.page)}-${device}.png`);
      if (existsSync(shot)) {
        const meta = await sharp(shot).metadata();
        const b = cropBox(device, meta.width ?? 390, meta.height ?? 844, r.x, r.y);
        const marker = Buffer.from(`<svg width="${b.width}" height="${b.height}"><circle cx="${b.px - b.left}" cy="${b.py - b.top}" r="22" fill="none" stroke="#ff2d2d" stroke-width="5"/><circle cx="${b.px - b.left}" cy="${b.py - b.top}" r="4" fill="#ff2d2d"/></svg>`);
        crop = join(relDir, `${r.id}.png`);
        await sharp(shot).extract({ left: b.left, top: b.top, width: b.width, height: b.height }).composite([{ input: marker }]).png().toFile(join(siteDir, crop));
      }
    }
    compiled.push({ id: r.id, page: r.page, device: r.device, text: r.text, crop });
    d().prepare('UPDATE feedback SET crop_path = ?, round = ? WHERE id = ?').run(crop, round, r.id);
  }
  const note = compileNote(round, compiled);
  const fbDir = join(DATA_DIR, 'feedback', slug);
  mkdirSync(fbDir, { recursive: true });
  const notePath = join(fbDir, `round-${round}.md`);
  writeFileSync(notePath, note);
  const rules = unsent.filter((r) => r.rule === 1);
  if (rules.length) {
    const file = join(DATA_DIR, 'pipeline-rules.md');
    if (!existsSync(file)) writeFileSync(file, '# Pipeline rules inbox\n\nReview comments flagged "also a pipeline rule". Fold each into the starter, the build skill, site types or a gate so no site needs it by hand again, then delete it here.\n');
    appendFileSync(file, rules.map((r) => `\n- ${isoNow().slice(0, 10)} · ${name} · ${r.page ?? 'whole site'}${r.device ? ` (${r.device})` : ''}: ${r.text}`).join('') + '\n');
  }
  return { round, note, notePath, count: compiled.length };
}
