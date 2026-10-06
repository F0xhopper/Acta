import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { chromium } from 'playwright';
import type { Brand, Facts } from './contracts.js';
import { colourWord } from './gather/colours.js';

/** Log in to Pinterest once in a visible browser and keep the session for headless research. */
export async function pinterestLogin(sessionPath: string): Promise<void> {
  mkdirSync(join(sessionPath, '..'), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ locale: 'en-GB' });
  const page = await ctx.newPage();
  await page.goto('https://www.pinterest.co.uk/login/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 5 * 60 * 1000 });
  await page.waitForTimeout(2000);
  await ctx.storageState({ path: sessionPath });
  await browser.close();
}

export function researchQueries(brand: Brand, facts: Facts): string[] {
  const cat = facts.business.category_label.toLowerCase();
  const colour = colourWord(brand.palette.primary);
  const hints = brand.tone_hints;
  const mood = hints.some((h) => /modern|luxury/.test(h)) ? 'modern' : hints.some((h) => /traditional|family/.test(h)) ? 'traditional' : 'clean';
  return [...new Set([
    `${cat} website design${colour && colour !== 'white' && colour !== 'grey' ? ` ${colour}` : ''}`,
    `${mood} ${cat} website hero`,
    `${cat} landing page inspiration`,
  ])];
}

export interface ResearchResult { pins: number; queries: string[]; boardPath: string; fallback: boolean }

/** Per-lead inspiration board: Pinterest pins (with a saved session) and competitor screenshots. Never throws. */
export async function researchLead(brand: Brand, facts: Facts, outDir: string, opts: { sessionPath: string; queries?: string[]; log?: (m: string) => void; pinsPerQuery?: number }): Promise<ResearchResult> {
  const log = opts.log ?? (() => undefined);
  mkdirSync(join(outDir, 'pinterest'), { recursive: true });
  mkdirSync(join(outDir, 'competitors'), { recursive: true });
  const queries = (opts.queries?.length ? opts.queries : researchQueries(brand, facts));
  const pins: { query: string; file: string; alt: string }[] = [];
  let fallback = false;
  let reason = '';

  if (!existsSync(opts.sessionPath)) {
    fallback = true;
    reason = 'no Pinterest session saved (run: pipeline research --login)';
  } else {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ storageState: opts.sessionPath, viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
      const page = await ctx.newPage();
      for (const q of queries) {
        await page.goto(`https://www.pinterest.co.uk/search/pins/?q=${encodeURIComponent(q)}`, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(3000);
        if (/\/login/.test(page.url())) { fallback = true; reason = 'Pinterest session expired (login wall)'; break; }
        for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(1500); }
        const els = await page.$$('[data-test-id="pin"], div[data-grid-item="true"], div[data-grid-item]');
        if (!els.length) { fallback = true; reason = 'no pins rendered'; break; }
        let n = 0;
        for (const el of els) {
          if (n >= (opts.pinsPerQuery ?? 8)) break;
          try {
            const box = await el.boundingBox();
            if (!box || box.width < 120 || box.height < 120) continue;
            const alt = (await el.$eval('img[alt]', (img) => (img as HTMLImageElement).alt).catch(() => '')) || '';
            const file = join(outDir, 'pinterest', `${q.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${n + 1}.png`);
            await el.screenshot({ path: file });
            pins.push({ query: q, file, alt: alt.replace(/\s+/g, ' ').trim().slice(0, 200) });
            n++;
            await page.waitForTimeout(600);
          } catch { /* skip this pin */ }
        }
        log(`research: ${n} pins for "${q}"`);
        await page.waitForTimeout(1500);
      }
      await ctx.close();
    } catch (e) {
      fallback = true;
      reason = `Pinterest failed: ${(e as Error).message.split('\n')[0].slice(0, 120)}`;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
  if (fallback) log(`research: Pinterest fell back (${reason})`);

  const comps: { name: string; url: string; file: string | null; notes: string | null }[] = [];
  for (const c of facts.competitors) {
    let file: string | null = null;
    if (c.screenshot && existsSync(c.screenshot)) {
      file = join(outDir, 'competitors', basename(c.screenshot));
      try { copyFileSync(c.screenshot, file); } catch { file = null; }
    }
    comps.push({ name: c.name, url: c.url, file, notes: c.notes });
  }

  const rel = (p: string) => relative(outDir, p);
  const md: string[] = [
    `# Inspiration board: ${brand.name}`, '',
    `${fallback ? `Pinterest did not run (${reason}).` : `Pinterest ran with ${pins.length} pins.`} Competitors: ${comps.length}.`, '',
    '## Searches', '', ...queries.map((q) => `- ${q}`), '',
  ];
  if (pins.length) {
    md.push('## Pinterest pins', '', 'Layout, hierarchy, palette and mood only. Never copy anything.', '');
    for (const p of pins) md.push(`![${p.alt || p.query}](${rel(p.file)})`, '', `*${p.query}*: ${p.alt || 'no caption'}`, '');
  }
  if (comps.length) {
    md.push('## Local competitors with good sites', '', 'To be different from, not to copy.', '');
    for (const c of comps) md.push(`- **${c.name}** ${c.url}${c.notes ? ` — ${c.notes}` : ''}${c.file ? `\n\n  ![${c.name}](${rel(c.file)})` : ''}`, '');
  }
  const boardPath = join(outDir, 'board.md');
  writeFileSync(boardPath, md.join('\n'));
  return { pins: pins.length, queries, boardPath, fallback };
}
