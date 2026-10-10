import { chromium, devices } from 'playwright';
import { hostMatches, hostOf } from '../../util/http.js';
import { loadScoring } from '../../config.js';
import { archiveOriginal } from '../../audit/rescue.js';
import { isArchiveUrl, parsePage } from './parse.js';
import type { PageData, PageStyles } from './types.js';

const LINK_RE = /about|service|contact|gallery|team|our|work|price|menu|treatment/i;

interface Evaluated {
  styles: PageStyles;
  images: { src: string; alt: string | null; title: string | null; className: string | null; width: number; height: number; inHeader: boolean; nearText: string | null }[];
  links: { href: string; text: string }[];
  text: string;
}

/** Crawl the homepage and up to `max` inner pages in a real phone browser. Never throws; returns what it managed. */
export async function crawlSite(startUrl: string, opts: { max?: number; log?: (m: string) => void; timeoutMs?: number } = {}): Promise<PageData[]> {
  const max = opts.max ?? 8;
  const timeout = opts.timeoutMs ?? 20000;
  const scoring = loadScoring();
  const host = hostOf(startUrl);
  if (!host || hostMatches(host, [...scoring.hosts.social, ...scoring.hosts.directory, ...scoring.hosts.platform])) return [];
  // An archived copy (web.archive.org): inner links wrap the original URL, so the same-site test looks at the original.
  const archive = isArchiveUrl(startUrl);
  const originalHost = archive ? hostOf(archiveOriginal(startUrl) ?? '') : null;
  if (archive && !originalHost) return [];
  const pages: PageData[] = [];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true, locale: 'en-GB' });
  try {
    const page = await ctx.newPage();
    // tsx/esbuild injects a __name helper into functions passed to page.evaluate; make it a no-op in the page.
    await page.addInitScript('window.__name = window.__name || ((f) => f);');
    const queue: string[] = [startUrl];
    const seen = new Set<string>([startUrl.replace(/\/$/, '')]);
    while (queue.length && pages.length < max + 1) {
      const url = queue.shift()!;
      try {
        try { await page.goto(url, { waitUntil: 'networkidle', timeout }); } catch { await page.goto(url, { waitUntil: 'load', timeout }); }
        await page.waitForTimeout(800);
        if (archive) await page.evaluate(removeWaybackChrome);
        const html = await page.content();
        const ev = await page.evaluate(evaluatePage);
        const data = parsePage(html, page.url());
        data.styles = ev.styles;
        data.text = ev.text || data.text;
        // Prefer live sizes and header detection from the browser.
        const bySrc = new Map(ev.images.map((i) => [i.src, i]));
        data.images = data.images.map((i) => {
          const live = bySrc.get(i.src);
          return live ? { ...i, width: live.width || i.width, height: live.height || i.height, inHeader: live.inHeader || i.inHeader, nearText: live.nearText ?? i.nearText } : i;
        });
        for (const live of ev.images) if (!data.images.some((i) => i.src === live.src) && live.width) data.images.push(live);
        pages.push(data);
        opts.log?.(`crawled ${page.url()} (${data.images.length} images)`);
        if (pages.length === 1) {
          for (const l of ev.links) {
            let u: URL;
            try { u = new URL(l.href, url); } catch { continue; }
            if (u.hostname.replace(/^www\./, '') !== host) continue;
            let path = u.pathname;
            if (archive) {
              // Only the business's own pages, as they were: not the archive's copies of the sites it linked to.
              let o: URL;
              try { o = new URL(archiveOriginal(u.toString()) ?? ''); } catch { continue; }
              if (o.hostname.replace(/^www\./, '') !== originalHost) continue;
              path = o.pathname;
            }
            if (!LINK_RE.test(path) && !LINK_RE.test(l.text)) continue;
            if (/\.(pdf|jpg|png|zip)$/i.test(path)) continue;
            u.hash = '';
            const key = u.toString().replace(/\/$/, '');
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push(u.toString());
            if (queue.length >= max) break;
          }
        }
        await page.waitForTimeout(500);
      } catch (e) {
        opts.log?.(`crawl skipped ${url}: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  return pages;
}

/** Runs in the page: drop the Wayback Machine's toolbar and scripts before the page is read. */
function removeWaybackChrome(): void {
  for (const id of ['wm-ipp-base', 'wm-ipp', 'wm-ipp-print', 'donato', 'wm-ipp-inner']) document.getElementById(id)?.remove();
  document.querySelectorAll('script[src*="/_static/"], link[href*="/_static/"], style[id^="wm-"]').forEach((el) => el.remove());
}

function evaluatePage(): Evaluated {
  const cs = (el: Element | null, prop: string): string | null => (el ? getComputedStyle(el).getPropertyValue(prop) || null : null);
  const header = document.querySelector('header, nav, [role="banner"], [class*="header"], [id*="header"], [class*="navbar"]');
  const navLink = document.querySelector('nav a, header a');
  const button = document.querySelector('button, a[class*="btn"], a[class*="button"], [role="button"], input[type="submit"]');
  const h1 = document.querySelector('h1');
  const styles: PageStyles = {
    header: { bg: cs(header, 'background-color'), color: cs(header, 'color') },
    navLink: { color: cs(navLink, 'color') },
    button: { bg: cs(button, 'background-color'), color: cs(button, 'color') },
    h1: { fontFamily: cs(h1, 'font-family'), color: cs(h1, 'color') },
    body: { fontFamily: cs(document.body, 'font-family'), color: cs(document.body, 'color'), bg: cs(document.body, 'background-color') || cs(document.documentElement, 'background-color') },
  };
  const images = Array.from(document.images).map((img) => ({
    src: img.currentSrc || img.src,
    alt: img.alt || null,
    title: img.title || null,
    className: typeof img.className === 'string' ? img.className : null,
    width: img.naturalWidth || 0,
    height: img.naturalHeight || 0,
    inHeader: !!img.closest('header, nav, [role="banner"], [class*="header"], [id*="header"], [class*="navbar"]'),
    nearText: (() => { const t = (img.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim(); return t && t.length <= 80 ? t : null; })(),
  })).filter((i) => i.src && !i.src.startsWith('data:'));
  const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim().slice(0, 60) }));
  return { styles, images, links, text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 60_000) };
}
