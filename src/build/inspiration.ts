/**
 * Inspiration for one build, saved as screenshots the designer can look at:
 *   - curated craft sites for the site type (hand-picked in config/inspiration.yaml), captured in full:
 *     phone, desktop, and the first three desktop screens, so the designer sees real pages;
 *   - structure references: real, highly rated businesses of the same trade in other UK cities (Places API);
 *   - gallery pages for the trade (one tall screenshot of the results).
 * Writes acta/research/inspiration.md describing what's there and how to use it. Never throws: research is
 * a help, not a gate.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';
import { searchText, type Budget } from '../discover/places.js';

const Curated = z.object({ name: z.string(), url: z.string().url(), note: z.string() });
const Schema = z.object({
  mix: z.object({ craft: z.number().default(5), structure: z.number().default(3) }),
  curated: z.object({ max_per_build: z.number().default(8), from_any: z.number().default(2) }).catchall(z.array(Curated)),
  real_sites: z.object({ cities: z.array(z.string()), per_build: z.number().default(2), min_rating: z.number().default(4.6), min_reviews: z.number().default(80), max_sites: z.number().default(3) }),
  galleries: z.array(z.object({ name: z.string(), kind: z.enum(['craft', 'structure']), url: z.string() })),
  site_types: z.record(z.string(), z.object({ awwwards: z.string() })),
});
export type InspirationConfig = z.infer<typeof Schema>;
export type CuratedSite = z.infer<typeof Curated>;
export const loadInspiration = (): InspirationConfig => Schema.parse(parseYaml(readFileSync(join(ROOT, 'config', 'inspiration.yaml'), 'utf8')));

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const hash = (seed: string) => { let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
/** Booking platforms, social pages and directories are not a business's own site. */
const NOT_OWN_SITE = /(facebook|instagram|fresha|booksy|treatwell|setmore|square\.site|linktr\.ee|yell\.com|google\.|wixsite|tiktok|calendly|vagaro|squareup|nearcut|timely|bookwhen|phorest|salonized|styleseat|simplybook|acuityscheduling|schedulicity|shedul|bookitit|ueni|business\.site)/i;
/** Schools, academies and franchises are not a local business like the one being built for. */
const NOT_LOCAL_SHOP = /(school|academy|college|training|franchise|group ltd|headquarters)/i;

/** The gallery addresses for a trade and site type. Pure. */
export function galleryTargets(cfg: InspirationConfig, siteType: string, trade: string) {
  const t = cfg.site_types[siteType] ?? cfg.site_types.default;
  return cfg.galleries.map((g) => ({ ...g, url: g.url.replace('{trade}', encodeURIComponent(trade)).replace('{awwwards}', t.awwwards) }));
}

/** Which cities to search for this build, rotated by a seed so builds see different sites. Pure. */
export function citiesFor(cfg: InspirationConfig, seed: string, exclude: string): string[] {
  const list = cfg.real_sites.cities.filter((c) => c.toLowerCase() !== exclude.toLowerCase());
  const h = hash(seed);
  return Array.from({ length: Math.min(cfg.real_sites.per_build, list.length) }, (_, i) => list[(h + i) % list.length]);
}

/**
 * The curated craft sites for this build: the site type's list rotated by seed, with room kept for a rotating pair
 * from `any`, without duplicate hosts, capped at max_per_build. Two builds of the same type see different sets. Pure.
 */
export function curatedFor(cfg: InspirationConfig, siteType: string, seed: string): CuratedSite[] {
  const { max_per_build, from_any, ...lists } = cfg.curated;
  const rotate = <T,>(xs: T[], h: number) => xs.length ? xs.map((_, i) => xs[(h + i) % xs.length]) : xs;
  const h = hash(seed);
  const own = rotate((lists[siteType] ?? lists.default ?? []) as CuratedSite[], h);
  const any = rotate(((lists.any ?? []) as CuratedSite[]).filter((a) => !own.some((o) => host(o.url) === host(a.url))), h);
  const out: CuratedSite[] = [];
  const add = (s: CuratedSite) => { if (out.length < max_per_build && !out.some((o) => host(o.url) === host(s.url))) out.push(s); };
  for (const s of own.slice(0, Math.max(0, max_per_build - from_any))) add(s);
  for (const s of any.slice(0, from_any)) add(s);
  for (const s of own) add(s);
  return out;
}
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

export interface RealSite { name: string; city: string; url: string; rating: number; reviews: number; mobile: string | null; desktop: string | null }
export interface CuratedShot extends CuratedSite { mobile: string | null; desktop: string | null; scroll: string | null }
export interface InspirationResult { curated: CuratedShot[]; realSites: RealSite[]; galleries: { name: string; kind: string; url: string; shot: string | null }[]; notes: string[] }

/** Cookie banners, consent walls and newsletter pop-ups, so the page itself is visible. Best effort, quick. */
async function dismissBanners(page: Page) {
  const selectors = [
    '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '.cc-btn.cc-allow', 'button[data-testid="uc-accept-all-button"]',
    '#accept-cookies', '.js-cookie-accept', 'button[id*="accept" i]', 'button[class*="accept" i]', 'a[id*="accept" i]',
    '.klaviyo-close-form', '[role="dialog"] [aria-label*="close" i]', 'button[aria-label*="close" i]', 'button[class*="close" i]', '[class*="popup" i] [class*="close" i]', '[class*="modal" i] [class*="close" i]',
  ];
  let clicked = false;
  for (const s of selectors) {
    const b = page.locator(s).first();
    if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 1500 }).catch(() => undefined); clicked = true; break; }
  }
  if (!clicked) {
    const b = page.getByRole('button', { name: /^((accept|allow)( all)?( cookies)?|i agree|agree|got it|ok(ay)?|continue|no,? thanks|yes,? i'?m happy)$/i }).first();
    if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 1500 }).catch(() => undefined); clicked = true; }
  }
  // Most pop-ups close on Escape; a page without one ignores it.
  await page.keyboard.press('Escape').catch(() => undefined);
  if (clicked) await page.waitForTimeout(500);
  // Whatever is still fixed over the page and smells like a consent or newsletter overlay goes, with the scroll lock it set.
  await page.evaluate(() => {
    const smell = /modal|popup|pop-up|cookie|consent|newsletter|overlay|gdpr|privacy|dialog|lightbox|subscribe/i;
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const cover = (r.width * r.height) / (vw * vh);
      const isHeaderOrBar = r.height < 160 && (r.top <= 2 || r.bottom >= vh - 2);
      if (isHeaderOrBar) continue;
      const text = `${el.id} ${el.className} ${el.getAttribute('role') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
      const smells = smell.test(text) || !!el.querySelector('[role="dialog"], [class*="cookie" i], [class*="consent" i], [class*="newsletter" i]');
      // A consent box can be small and still sit over the page. Nothing that doesn't look like an overlay is touched.
      if (smells && cover >= 0.03) el.remove();
    }
    for (const el of [document.documentElement, document.body]) { el.style.overflow = ''; el.style.position = ''; el.classList.remove('no-scroll', 'modal-open', 'overflow-hidden'); }
  }).catch(() => undefined);
}

/** Scroll through the page so lazy images and reveal-on-scroll sections render, then return to the top. */
async function warm(page: Page, to: number) {
  for (let y = 0; y < to; y += 600) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(90); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

type Shot = 'mobile' | 'desktop' | 'scroll';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CONTEXTS: Record<Shot, Parameters<Browser['newContext']>[0]> = {
  mobile: { ...devices['iPhone 13'], deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, userAgent: DESKTOP_UA },
  scroll: { viewport: { width: 1440, height: 2700 }, userAgent: DESKTOP_UA },
};

/** One screenshot, with a hard deadline: a slow site must never hold up a build. */
async function shoot(browser: Browser, url: string, file: string, kind: Shot, deadlineMs = 45_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((res) => { timer = setTimeout(() => res(false), deadlineMs); });
  const ctx = await browser.newContext({ ...CONTEXTS[kind], locale: 'en-GB', reducedMotion: 'reduce' });
  try { return await Promise.race([capture(ctx, url, file, kind), deadline]); }
  finally { clearTimeout(timer); await ctx.close().catch(() => undefined); }
}

async function capture(ctx: BrowserContext, url: string, file: string, kind: Shot): Promise<boolean> {
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await dismissBanners(page);
    await warm(page, kind === 'scroll' ? 2700 : kind === 'mobile' ? 900 : 600);
    // Pop-ups often arrive late, on scroll or on a timer: clear them again right before the shot.
    await dismissBanners(page);
    await page.screenshot({ path: file, fullPage: false, timeout: 10000, animations: 'disabled' });
    return true;
  } catch { return false; }
}

/** Run tasks a few at a time. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

export async function collectInspiration(o: { trade: string; siteType: string; homeCity: string; seed: string; outDir: string; budget: Budget; log?: (m: string) => void }): Promise<InspirationResult> {
  const log = o.log ?? (() => undefined);
  const result: InspirationResult = { curated: [], realSites: [], galleries: [], notes: [] };
  let cfg: InspirationConfig;
  try { cfg = loadInspiration(); } catch (e) { result.notes.push(`config/inspiration.yaml unreadable: ${(e as Error).message}`); return result; }
  const craftDir = join(o.outDir, 'craft'); const realDir = join(o.outDir, 'real-sites'); const galDir = join(o.outDir, 'galleries');
  for (const d of [craftDir, realDir, galDir]) mkdirSync(d, { recursive: true });

  // 1. Structure references: real businesses of the same trade elsewhere, with their own site.
  const candidates: Omit<RealSite, 'mobile' | 'desktop'>[] = [];
  for (const city of citiesFor(cfg, o.seed, o.homeCity)) {
    if (o.budget.used >= o.budget.max) { result.notes.push('Places request budget used up; fewer structure references than usual.'); break; }
    try {
      const places = await searchText(`${o.trade} in ${city}`, { pages: 1, budget: o.budget });
      for (const p of places) {
        if (!p.websiteUri || NOT_OWN_SITE.test(p.websiteUri) || NOT_LOCAL_SHOP.test(p.displayName?.text ?? '')) continue;
        if ((p.rating ?? 0) < cfg.real_sites.min_rating || (p.userRatingCount ?? 0) < cfg.real_sites.min_reviews) continue;
        candidates.push({ name: p.displayName?.text ?? 'Unknown', city, url: p.websiteUri.replace(/[?#].*$/, ''), rating: p.rating ?? 0, reviews: p.userRatingCount ?? 0 });
      }
    } catch (e) { result.notes.push(`Search "${o.trade} in ${city}" failed: ${(e as Error).message}`); }
  }
  candidates.sort((a, b) => b.reviews * b.rating - a.reviews * a.rating);
  const picked = candidates.filter((c, i, all) => all.findIndex((x) => host(x.url) === host(c.url)) === i).slice(0, cfg.real_sites.max_sites);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const b = browser;
    // 2. Curated craft sites: phone, desktop, and the first three desktop screens.
    await pool(curatedFor(cfg, o.siteType, o.seed), 4, async (s) => {
      const base = slugify(s.name);
      const files: Record<Shot, string> = { mobile: join(craftDir, `${base}-mobile.png`), desktop: join(craftDir, `${base}-desktop.png`), scroll: join(craftDir, `${base}-desktop-scroll.png`) };
      const ok: boolean[] = [];
      for (const k of ['mobile', 'desktop', 'scroll'] as Shot[]) ok.push(await shoot(b, s.url, files[k], k));
      if (ok.some(Boolean)) result.curated.push({ ...s, mobile: ok[0] ? `craft/${base}-mobile.png` : null, desktop: ok[1] ? `craft/${base}-desktop.png` : null, scroll: ok[2] ? `craft/${base}-desktop-scroll.png` : null });
      else result.notes.push(`Could not capture ${s.name} (${s.url}).`);
    });
    log(`inspiration: ${result.curated.length} craft references captured`);
    await pool(picked, 3, async (s) => {
      const base = slugify(`${s.name}-${s.city}`);
      const m = join(realDir, `${base}-mobile.png`), dk = join(realDir, `${base}-desktop.png`);
      const [okM, okD] = await Promise.all([shoot(b, s.url, m, 'mobile'), shoot(b, s.url, dk, 'desktop')]);
      if (okM || okD) result.realSites.push({ ...s, mobile: okM ? `real-sites/${base}-mobile.png` : null, desktop: okD ? `real-sites/${base}-desktop.png` : null });
    });
    log(`inspiration: ${result.realSites.length} real ${o.trade} sites from other cities`);
    // 3. Gallery pages: a tall screenshot of the results, so the agent sees many thumbnails at once.
    await pool(galleryTargets(cfg, o.siteType, o.trade), 3, async (g) => {
      const file = join(galDir, `${slugify(g.name)}.png`);
      const ok = await shoot(b, g.url, file, 'scroll', 35_000);
      result.galleries.push({ name: g.name, kind: g.kind, url: g.url, shot: ok ? `galleries/${slugify(g.name)}.png` : null });
    });
    log(`inspiration: ${result.galleries.filter((g) => g.shot).length} of ${result.galleries.length} galleries captured`);
  } catch (e) { result.notes.push(`Screenshots failed: ${(e as Error).message}`); } finally { await browser?.close(); }

  writeFileSync(join(o.outDir, 'inspiration.md'), inspirationMd(cfg, o.trade, result));
  return result;
}

/** The note the designer reads: what was collected, and how to use it. Pure. */
export function inspirationMd(cfg: InspirationConfig, trade: string, r: InspirationResult): string {
  const path = (p: string | null) => (p ? `\`acta/research/${p}\`` : null);
  const lines = [
    `# Inspiration for this ${trade} site`, '',
    `Pick ${cfg.mix.craft + cfg.mix.structure} references: about ${cfg.mix.craft} craft and ${cfg.mix.structure} structure. Look at every screenshot listed here with Read before choosing.`, '',
    '## Craft sets the bar', '',
    'The craft references are hand-picked sites with studio-level type, space and imagery. They decide how good this site has to look:',
    '- Type with a real scale: a display size on desktop that is at least three times the body size, few weights, tight leading on headings.',
    '- Space: generous section rhythm, long margins on desktop, one dominant element per section, nothing boxed for the sake of it.',
    '- Imagery: photos large enough to feel, often full width or full height, cropped with intent.',
    '- One memorable move that belongs to the business, carried through every page.',
    'Borrow their confidence, their scale and their restraint. Never their content, logos, illustrations or words.', '',
    '## Structure is the floor', '',
    'The structure references are real sites of the same trade with happy customers. They show which sections a visitor expects and where prices, hours and the call or book action go. Take the section order and the first-screen checklist from them; take nothing else, and never their look.', '',
    '## Craft references', '',
    ...(r.curated.length ? r.curated.flatMap((c) => [
      `- **${c.name}** ${c.url}`,
      `  ${c.note}`,
      `  ${[['phone', c.mobile], ['desktop', c.desktop], ['desktop, first three screens', c.scroll]].filter(([, p]) => p).map(([k, p]) => `${k}: ${path(p as string)}`).join(' · ')}`,
    ]) : ['- None captured this time: pick from the galleries instead.']),
    '', '## Structure references: real businesses of the same trade, elsewhere in the UK', '',
    ...(r.realSites.length ? r.realSites.map((s) => `- **${s.name}** (${s.city}, ${s.rating} from ${s.reviews} reviews) ${s.url}${s.mobile ? ` · phone: ${path(s.mobile)}` : ''}${s.desktop ? ` · desktop: ${path(s.desktop)}` : ''}`) : ['- None found this time.']),
    '', '## Galleries', '',
    'Screenshots of the results for this trade. Open a gallery with WebFetch to find a specific site, then run `pnpm refs <url>` to capture it into `acta/research/refs/` and look at it. Prefer this over judging from thumbnails.', '',
    ...r.galleries.map((g) => `- **${g.name}** (${g.kind}) ${g.url}${g.shot ? ` · ${path(g.shot)}` : ' · (could not capture)'}`),
    ...(r.notes.length ? ['', '## Notes', '', ...r.notes.map((n) => `- ${n}`)] : []),
    '', 'Never copy text, images, logos or illustrations from any reference. Take layout, hierarchy, rhythm, scale and mood only.', '',
  ];
  return lines.join('\n');
}
