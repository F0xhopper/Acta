/**
 * Full-page screenshots of every page of a site, phone and desktop, for annotating in the review screen.
 * Uses the live preview when there is one, otherwise starts the built site locally.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { openDb } from '../db/index.js';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium, devices, type Page } from 'playwright';
import { ROOT } from '../config.js';
import { getLeadBySlug } from '../db/queries.js';
import { getBuild } from '../build/queries.js';
import { sleep } from '../util/http.js';
import { log } from '../util/log.js';

export const routeSlug = (path: string) => (path === '/' || path === '' ? 'home' : path.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase());

/** Paths from a sitemap.xml, deduped, home first, capped. */
export function sitemapPaths(xml: string, cap = 12): string[] {
  const paths = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => { try { return new URL(m[1]).pathname; } catch { return m[1]; } });
  const uniq = [...new Set(['/', ...paths.map((p) => (p.length > 1 ? p.replace(/\/$/, '') : p))])];
  return uniq.slice(0, cap);
}

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => (a && typeof a === 'object' ? res(a.port) : rej(new Error('no port')))); }); });

async function startLocal(dir: string): Promise<{ url: string; child: ChildProcess } | null> {
  if (!existsSync(join(dir, '.next'))) return null;
  const port = await freePort();
  const child = spawn('pnpm', ['-s', 'start', '-p', String(port)], { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, ACTA_PREVIEW: '1' } });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(url); if (r.status < 500) return { url, child }; } catch { /* not up yet */ }
    await sleep(500);
  }
  try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  return null;
}

async function settle(page: Page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(100); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}

const running = new Set<string>();
export const shotsRunning = (slug: string) => running.has(slug);

export async function takePageShots(slug: string): Promise<{ ok: boolean; pages: number; reason?: string }> {
  if (running.has(slug)) return { ok: false, pages: 0, reason: 'already running' };
  running.add(slug);
  let local: { url: string; child: ChildProcess } | null = null;
  try {
    const lead = getLeadBySlug(slug);
    const b = lead ? getBuild(lead.id) : undefined;
    const dir = join(ROOT, 'sites', slug);
    if (!existsSync(dir)) return { ok: false, pages: 0, reason: 'no site repo' };
    let base = b?.preview_url ?? null;
    if (!base) { local = await startLocal(dir); base = local?.url ?? null; }
    if (!base) return { ok: false, pages: 0, reason: 'no preview URL and the site is not built locally' };
    let paths = ['/'];
    try { paths = sitemapPaths(await (await fetch(`${base.replace(/\/$/, '')}/sitemap.xml`)).text()); } catch { /* home only */ }
    const out = join(dir, 'acta', 'qa', 'pages');
    mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const manifest: { path: string; file: string }[] = [];
    try {
      for (const [device, ctxOpts] of [['mobile', { ...devices['iPhone 13'], deviceScaleFactor: 2 }], ['tablet', { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1440, height: 900 } }]] as const) {
        const ctx = await browser.newContext({ ...ctxOpts, ignoreHTTPSErrors: true, locale: 'en-GB' });
        const page = await ctx.newPage();
        for (const p of paths) {
          try {
            await page.goto(base.replace(/\/$/, '') + p, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base!.replace(/\/$/, '') + p, { waitUntil: 'load', timeout: 30000 }));
            await settle(page);
            const file = routeSlug(p);
            await page.screenshot({ path: join(out, `${file}-${device}.png`), fullPage: true });
            if (device === 'mobile') manifest.push({ path: p, file });
          } catch (e) { log.warn(`shots ${slug} ${p} ${device}: ${(e as Error).message.split('\n')[0]}`); }
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
    writeFileSync(join(out, 'pages.json'), JSON.stringify(manifest, null, 2));
    // Keep this set as the current review round, so Compare can show any two rounds side by side.
    const round = (openDb().prepare('SELECT MAX(round) r FROM feedback WHERE slug = ?').get(slug) as { r: number | null }).r ?? 0;
    const roundDir = join(dir, 'acta', 'qa', 'rounds', String(round));
    rmSync(roundDir, { recursive: true, force: true });
    cpSync(out, roundDir, { recursive: true });
    writeFileSync(join(roundDir, 'taken.json'), JSON.stringify({ round, takenAt: new Date().toISOString() }));
    return { ok: true, pages: manifest.length };
  } finally {
    if (local?.child.pid) { try { process.kill(-local.child.pid, 'SIGTERM'); } catch { /* gone */ } }
    running.delete(slug);
  }
}
