/**
 * The two build checkpoints: the build stops after gather for you to sort the photos, and after the
 * concepts are written for you to choose one. Everything here works on files in the site repo, so the
 * CLI, the overnight builder and the UI all see the same state.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from '../config.js';
import { BrandSchema, FactsSchema, SITE_PATHS } from './contracts.js';
import { commitAll } from './repo.js';
import { siteContentSource } from './site-content.js';

export interface Checkpoints { photos: boolean; concept: boolean }

export function loadCheckpoints(): Checkpoints {
  if (process.env.ACTA_CHECKPOINTS === 'off') return { photos: false, concept: false };
  try {
    const raw = parseYaml(readFileSync(join(ROOT, 'config', 'build.yaml'), 'utf8')) as { checkpoints?: Partial<Checkpoints> };
    return { photos: raw.checkpoints?.photos !== false, concept: raw.checkpoints?.concept !== false };
  } catch { return { photos: true, concept: true }; }
}

/** Thrown by a step to stop the build cleanly in a waiting state. Not a failure. */
export class Paused extends Error {
  constructor(public state: 'awaiting_photos' | 'awaiting_concept', message: string) { super(message); }
}

export const PATHS = {
  curation: 'acta/curation.json',
  dropped: 'acta/photos-dropped',
  checkpoint: 'acta/checkpoint.json',
  concepts: 'acta/concepts.md',
  conceptsDir: 'acta/concepts',
  conceptsFeedback: 'acta/concepts-feedback.md',
} as const;

// ---------- photos ----------

export const DROP_REASONS = ['doorstep', 'clutter', 'close-up', 'low quality', 'not them', 'duplicate'];

export interface Curation {
  curated_at: string;
  skipped: boolean;
  hero: string | null;
  keep: string[];
  drop: { path: string; reason: string | null }[];
}
export interface PhotoChoiceIn { path: string; choice: 'keep' | 'drop' | 'hero'; reason?: string | null }

export const photosCurated = (dir: string) => existsSync(join(dir, PATHS.curation));
export function readCuration(dir: string): Curation | null {
  try { return JSON.parse(readFileSync(join(dir, PATHS.curation), 'utf8')) as Curation; } catch { return null; }
}

/** The photos as the brand lists them, plus any already moved aside by an earlier curation. */
export function listPhotos(dir: string): { path: string; source: string; width: number; height: number; alt: string | null; dropped: boolean }[] {
  const brand = BrandSchema.parse(JSON.parse(readFileSync(join(dir, SITE_PATHS.brand), 'utf8')));
  type Listed = { path: string; source: string; width: number; height: number; alt: string | null; dropped: boolean };
  const out: Listed[] = brand.photos.map((p) => ({ path: p.path, source: p.source, width: p.width, height: p.height, alt: p.alt, dropped: false }));
  const cur = readCuration(dir);
  for (const d of cur?.drop ?? []) {
    if (out.some((o) => o.path === d.path)) continue;
    const moved = join(PATHS.dropped, basename(d.path));
    if (existsSync(join(dir, moved))) out.push({ path: d.path, source: 'dropped', width: 0, height: 0, alt: null, dropped: true });
  }
  return out;
}

/**
 * Save your photo choices. With `apply` (the build is paused before any design), dropped photos are moved
 * out of public/brand/photos, the brand's photo list is rewritten hero first, and site.ts is regenerated,
 * so the agent never sees them. Without it, only the choices are recorded for the next build or revision.
 */
export async function saveCuration(dir: string, choices: PhotoChoiceIn[], opts: { apply: boolean; skipped?: boolean }): Promise<Curation> {
  const heroes = choices.filter((c) => c.choice === 'hero');
  const hero = heroes.length ? heroes[heroes.length - 1].path : null;
  const cur: Curation = {
    curated_at: new Date().toISOString(),
    skipped: !!opts.skipped,
    hero,
    keep: choices.filter((c) => c.choice !== 'drop').map((c) => c.path),
    drop: choices.filter((c) => c.choice === 'drop').map((c) => ({ path: c.path, reason: c.reason ?? null })),
  };
  if (opts.apply && !opts.skipped) {
    const brandPath = join(dir, SITE_PATHS.brand);
    const brand = BrandSchema.parse(JSON.parse(readFileSync(brandPath, 'utf8')));
    const dropSet = new Set(cur.drop.map((d) => d.path));
    mkdirSync(join(dir, PATHS.dropped), { recursive: true });
    for (const p of dropSet) {
      const src = join(dir, p);
      if (existsSync(src)) renameSync(src, join(dir, PATHS.dropped, basename(p)));
    }
    const kept = brand.photos.filter((p) => !dropSet.has(p.path));
    kept.sort((a, b) => (a.path === hero ? -1 : b.path === hero ? 1 : 0));
    brand.photos = kept;
    writeFileSync(brandPath, JSON.stringify(brand, null, 2));
    const facts = FactsSchema.parse(JSON.parse(readFileSync(join(dir, SITE_PATHS.facts), 'utf8')));
    writeFileSync(join(dir, SITE_PATHS.site), siteContentSource(brand, facts));
  }
  writeFileSync(join(dir, PATHS.curation), JSON.stringify(cur, null, 2));
  await commitAll(dir, opts.skipped ? 'chore: photos left to the automatic choice' : `chore: photos sorted by hand (${cur.keep.length} kept, ${cur.drop.length} dropped)`);
  return cur;
}

// ---------- concepts ----------

export interface ParsedConcept { index: number; name: string; idea: string; body: string; palette: string[]; score: number | null }

const sections = (md: string) => {
  const out: { title: string; body: string }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const line of md.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && !line.startsWith('###')) { if (cur) out.push({ title: cur.title, body: cur.lines.join('\n').trim() }); cur = { title: m[1], lines: [] }; }
    else if (cur) cur.lines.push(line);
  }
  if (cur) out.push({ title: cur.title, body: cur.lines.join('\n').trim() });
  return out;
};
const META = /^(scores?|chosen|agent'?s pick|notes?|summary|previous|rejected)/i;

export function parseConcepts(md: string): ParsedConcept[] {
  const secs = sections(md);
  const scoresBody = secs.find((s) => /^scores?/i.test(s.title))?.body ?? '';
  const list = secs.filter((s) => !META.test(s.title));
  return list.map((s, i) => {
    const m = s.title.match(/^concept\s*(\d+)\s*[:.\-–—]?\s*(.*)$/i);
    const index = m ? Number(m[1]) : i + 1;
    const name = (m ? m[2] : s.title).replace(/^["“]|["”]$/g, '').replace(/\*\*/g, '').trim() || `Concept ${index}`;
    const ideaLine = s.body.split('\n').find((l) => /idea/i.test(l) && l.trim().length > 8) ?? s.body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
    const idea = ideaLine.replace(/^[-*]\s*/, '').replace(/\*\*[^*]*\*\*:?\s*/g, '').trim();
    const palette = [...new Set((s.body.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase()))].slice(0, 6);
    return { index, name, idea, body: s.body, palette, score: scoreFor(scoresBody, index, name) };
  });
}

function scoreFor(scores: string, index: number, name: string): number | null {
  const line = scores.split('\n').find((l) => new RegExp(`concept\\s*${index}\\b`, 'i').test(l) || (name.length > 3 && l.toLowerCase().includes(name.toLowerCase())));
  if (!line) return null;
  const total = line.match(/total[^\d]*(\d+(?:\.\d+)?)/i) ?? line.match(/(\d+(?:\.\d+)?)\s*\/\s*(?:5|25)\b/) ?? line.match(/\|\s*(\d+(?:\.\d+)?)\s*\|?\s*$/);
  return total ? Number(total[1]) : null;
}

/** The concept the agent would choose, from "## Agent's pick" (or "## Chosen" when the agent chose itself). */
export function agentPick(md: string, concepts = parseConcepts(md)): number | null {
  const sec = sections(md).find((s) => /^agent'?s pick/i.test(s.title)) ?? sections(md).find((s) => /^chosen/i.test(s.title));
  if (!sec) return null;
  const n = sec.body.match(/concept\s*(\d+)/i);
  if (n) return Number(n[1]);
  const byName = concepts.find((c) => c.name.length > 3 && sec.body.toLowerCase().includes(c.name.toLowerCase()));
  return byName?.index ?? null;
}

export const readConceptsMd = (dir: string) => (existsSync(join(dir, PATHS.concepts)) ? readFileSync(join(dir, PATHS.concepts), 'utf8') : '');
export const conceptChosen = (dir: string) => /^##\s+Chosen\b/im.test(readConceptsMd(dir));
export const conceptsWritten = (dir: string) => parseConcepts(readConceptsMd(dir)).length >= 2;
export function chosenConcept(dir: string): { index: number | null; name: string; note: string | null } | null {
  const sec = sections(readConceptsMd(dir)).find((s) => /^chosen/i.test(s.title));
  if (!sec) return null;
  const n = sec.body.match(/concept\s*(\d+)/i);
  const note = sec.body.match(/^Note from the owner:\s*(.+)$/im)?.[1] ?? null;
  const first = sec.body.split('\n').find((l) => l.trim()) ?? '';
  return { index: n ? Number(n[1]) : null, name: first.replace(/^concept\s*\d+\s*[:.\-–—]?\s*/i, '').replace(/\.\s*Chosen.*$/i, '').trim(), note };
}

/** Record your choice as the "## Chosen" section the build skill resumes from. `index` null keeps the agent's pick. */
export async function chooseConcept(dir: string, index: number | null, note: string | null): Promise<{ index: number; name: string }> {
  const md = readConceptsMd(dir);
  const concepts = parseConcepts(md);
  if (!concepts.length) throw new Error('No concepts have been written yet');
  const pick = index ?? agentPick(md, concepts);
  const c = concepts.find((x) => x.index === pick);
  if (!c) throw new Error(index === null ? 'The agent did not name a pick; choose a concept' : `There is no concept ${index}`);
  const cleaned = md.replace(/\n##\s+Chosen\b[\s\S]*?(?=\n##\s|$)/i, '').trimEnd();
  const lines = ['', '', '## Chosen', '', `Concept ${c.index}: ${c.name}. Chosen by the owner${index === null ? ", agreeing with the agent's pick" : ''}.`];
  if (note?.trim()) lines.push('', `Note from the owner: ${note.trim().replace(/\n+/g, ' ')}`);
  writeFileSync(join(dir, PATHS.concepts), cleaned + lines.join('\n') + '\n');
  rmSync(join(dir, PATHS.checkpoint), { force: true });
  await commitAll(dir, `chore: concept ${c.index} chosen by the owner`);
  return { index: c.index, name: c.name };
}

/** Throw away the current concepts so the agent writes three new ones, guided by your note. */
export async function resetConcepts(dir: string, note: string): Promise<void> {
  const md = readConceptsMd(dir);
  if (md) writeFileSync(join(dir, `acta/concepts-rejected-${Date.now()}.md`), md);
  rmSync(join(dir, PATHS.concepts), { force: true });
  rmSync(join(dir, PATHS.conceptsDir), { recursive: true, force: true });
  const prev = existsSync(join(dir, PATHS.conceptsFeedback)) ? readFileSync(join(dir, PATHS.conceptsFeedback), 'utf8') : '# Feedback on rejected concepts\n';
  writeFileSync(join(dir, PATHS.conceptsFeedback), `${prev.trimEnd()}\n\n## ${new Date().toISOString().slice(0, 10)}\n\nNone of the previous three concepts were right. ${note.trim()}\n`);
  await commitAll(dir, 'chore: concepts rejected, new ones requested');
}

/** Screenshot each concept's static mock-up (acta/concepts/concept-<n>.html) on a phone and a desktop. */
export async function renderConceptMockups(dir: string, log?: (m: string) => void): Promise<number> {
  const cdir = join(dir, PATHS.conceptsDir);
  if (!existsSync(cdir)) return 0;
  const files = readdirSync(cdir).filter((f) => /^concept-\d+\.html$/.test(f));
  if (!files.length) return 0;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [device, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]] as const) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === 'mobile' ? 2 : 1 });
      const page = await ctx.newPage();
      for (const f of files) {
        try {
          await page.goto(`file://${join(cdir, f)}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => undefined);
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(cdir, f.replace('.html', `-${device}.png`)), fullPage: false });
        } catch (e) { log?.(`mock-up ${f} ${device}: ${(e as Error).message.split('\n')[0]}`); }
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return files.length;
}

/** Tell the agent, through a file, to stop after writing concepts. Removed once a concept is chosen. */
export function setConceptCheckpoint(dir: string, on: boolean) {
  const p = join(dir, PATHS.checkpoint);
  if (on) writeFileSync(p, JSON.stringify({ concept: true, why: 'The owner chooses the concept. Stop after phase 3; see the build skill.' }, null, 2));
  else rmSync(p, { force: true });
}
