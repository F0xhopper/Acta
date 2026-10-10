// Screenshots the site the way a person sees it: one screen at a time, on a phone and on a desktop, for every
// key page, with reduced motion on so nothing is caught mid-reveal. Run: pnpm shots [--url http://...] [--home]
//
// Writes:
//   acta/qa/hero-mobile.png, mobile.png, tablet.png, desktop.png   the home page (the pipeline and the previous-sites
//                                                                   memory use these; full-page ones are tall and hard to read)
//   acta/qa/pages/<page>-<device>-<n>.jpg                          one screen per slice, in scroll order (JPEG, so a run
//                                                                   stays small; the folder is not committed)
//   acta/qa/shots.md                                               the index: which slice shows which page and scroll range
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, devices, type Browser } from 'playwright';
import { startBuilt } from './lib/server';

const MAX_SLICES = { mobile: 10, desktop: 7 } as const;
const DEVICES = {
  mobile: { ...devices['iPhone 13'], deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 } },
} as const;
type Device = keyof typeof DEVICES;

/** The routes worth looking at: home, every fixed route the site type requires, the first of each [slug] route, and /menu if it exists. */
async function keyRoutes(base: string): Promise<string[]> {
  const routes = new Set<string>(['/']);
  const typeFile = 'acta/site-type.json';
  const fixed: string[] = existsSync(typeFile) ? (JSON.parse(readFileSync(typeFile, 'utf8')).pages as { route: string }[]).map((p) => p.route).filter((r) => !r.includes('[')) : ['/about', '/contact'];
  for (const r of fixed) routes.add(r);
  // The first service and the first area, from the sitemap the site publishes.
  try {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    for (const prefix of ['/services/', '/areas/']) { const first = locs.find((p) => p.startsWith(prefix) && p.length > prefix.length); if (first) routes.add(first); }
    if (locs.includes('/menu')) routes.add('/menu');
  } catch { /* no sitemap: home and the fixed routes are enough */ }
  const live: string[] = [];
  for (const r of routes) { try { if ((await fetch(base + r, { redirect: 'manual' })).status === 200) live.push(r); } catch { /* skip */ } }
  return live;
}

const pageSlug = (route: string) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'));

async function main() {
  const urlArg = process.argv.indexOf('--url');
  const given = urlArg >= 0 ? process.argv[urlArg + 1] : null;
  const homeOnly = process.argv.includes('--home');
  const server = given ? null : await startBuilt({ log: (s) => console.log(s) });
  const base = given ?? server!.url;
  mkdirSync('acta/qa', { recursive: true });
  rmSync('acta/qa/pages', { recursive: true, force: true });
  mkdirSync('acta/qa/pages', { recursive: true });
  const browser = await chromium.launch();
  const index: string[] = ['# Screenshots', '', 'Each file is one screen, as a visitor sees it, in scroll order. Phone slices are 390 by 844 CSS pixels; desktop slices are 1440 by 900. Read them in order to judge a page; read the first slice of each page to judge the first impression.', ''];
  try {
    await homeFullPages(browser, base);
    const routes = homeOnly ? ['/'] : await keyRoutes(base);
    for (const route of routes) {
      index.push(`## ${route}`, '');
      for (const device of Object.keys(DEVICES) as Device[]) {
        const files = await slices(browser, base, route, device);
        index.push(`### ${device}`, '', ...files.map((f) => `- \`${f.file}\` (${f.from} to ${f.to} px of ${f.height})`), '');
        console.log(`${route} ${device}: ${files.length} slices`);
      }
    }
  } finally {
    await browser.close();
    server?.stop();
  }
  writeFileSync('acta/qa/shots.md', index.join('\n'));
  console.log('acta/qa/shots.md');
}

/** The home page in full, for the pipeline: uniqueness evidence, the previous-sites memory and the pitch pack. */
async function homeFullPages(browser: Browser, base: string) {
  const shots: [string, Record<string, unknown>][] = [
    ['mobile', { ...devices['iPhone 13'] }],
    ['tablet', { ...devices['iPad (gen 7)'] }],
    ['desktop', { viewport: { width: 1440, height: 900 } }],
  ];
  for (const [name, ctxOpts] of shots) {
    const ctx = await browser.newContext({ ...ctxOpts, locale: 'en-GB', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await warm(page);
    await page.screenshot({ path: `acta/qa/${name}.png`, fullPage: true });
    if (name === 'mobile') await page.screenshot({ path: 'acta/qa/hero-mobile.png', fullPage: false });
    await ctx.close();
    console.log(`acta/qa/${name}.png`);
  }
}

/** Scroll through once so lazy images load and reveal-on-scroll sections are shown, then return to the top. */
async function warm(page: import('playwright').Page) {
  await page.waitForTimeout(300);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(100); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}

async function slices(browser: Browser, base: string, route: string, device: Device) {
  const ctx = await browser.newContext({ ...DEVICES[device], locale: 'en-GB', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const out: { file: string; from: number; to: number; height: number }[] = [];
  try {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await warm(page);
    const vh = page.viewportSize()!.height;
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 0, y = 0; y < height && i < MAX_SLICES[device]; i++, y += vh) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(150);
      const file = `acta/qa/pages/${pageSlug(route)}-${device}-${i + 1}.jpg`;
      await page.screenshot({ path: file, fullPage: false, type: 'jpeg', quality: 85 });
      out.push({ file, from: y, to: Math.min(y + vh, height), height });
    }
  } finally { await ctx.close(); }
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
