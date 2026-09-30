import * as cheerio from 'cheerio';
import type { PageData, PageIcon, PageImage } from './types.js';

const SOCIAL_RE = /(instagram\.com|facebook\.com|fb\.com|tiktok\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com)/i;

function abs(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try { return new URL(href.trim(), base).toString(); } catch { return null; }
}

/** Pull CSS custom properties that look like brand colours out of raw CSS or HTML. */
export function brandCssVars(cssOrHtml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of cssOrHtml.matchAll(/(--[\w-]*(?:primary|brand|accent|main|secondary|theme)[\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^;)]+\))/g)) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/**
 * PageData from static HTML. Used for tests and as the fallback when the browser crawl fails.
 * Natural image sizes are unknown here (0) unless width/height attributes are present. Styles are null.
 */
export function parsePage(html: string, url: string): PageData {
  const $ = cheerio.load(html);
  const headerSel = 'header, nav, [role="banner"], [class*="header"], [id*="header"], [class*="navbar"], [class*="nav-"]';
  const images: PageImage[] = [];
  $('img').each((_, el) => {
    const src = abs($(el).attr('src') ?? $(el).attr('data-src') ?? $(el).attr('data-lazy-src') ?? ($(el).attr('srcset') ?? '').split(/[\s,]/)[0], url);
    if (!src) return;
    const w = Number.parseInt($(el).attr('width') ?? '', 10);
    const h = Number.parseInt($(el).attr('height') ?? '', 10);
    images.push({
      src, alt: $(el).attr('alt') ?? null, title: $(el).attr('title') ?? null, className: $(el).attr('class') ?? null,
      width: Number.isFinite(w) ? w : 0, height: Number.isFinite(h) ? h : 0,
      inHeader: $(el).closest(headerSel).length > 0,
      nearText: (() => { const t = $(el).parent().text().replace(/\s+/g, ' ').trim(); return t && t.length <= 80 ? t : null; })(),
    });
  });
  const icons: PageIcon[] = [];
  $('link[rel]').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase();
    if (!/icon/.test(rel)) return;
    const href = abs($(el).attr('href'), url);
    if (href) icons.push({ rel, href, sizes: $(el).attr('sizes') ?? null });
  });
  const socialLinks = new Set<string>();
  const emails = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (SOCIAL_RE.test(href)) socialLinks.add(href.trim());
    if (href.startsWith('mailto:')) { const e = href.replace(/^mailto:/i, '').split('?')[0].trim(); if (e.includes('@')) emails.add(e.toLowerCase()); }
  });
  const fontLinks: string[] = [];
  $('link[href*="fonts.googleapis.com"]').each((_, el) => { const h = $(el).attr('href'); if (h) fontLinks.push(h); });
  const jsonLd: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => { jsonLd.push($(el).contents().text()); });
  const headings: string[] = [];
  $('h2, h3').each((_, el) => { const t = $(el).text().replace(/\s+/g, ' ').trim(); if (t) headings.push(t); });
  const navTexts: string[] = [];
  $('nav a, header a, [class*="menu"] a').each((_, el) => { const t = $(el).text().replace(/\s+/g, ' ').trim(); if (t && t.length < 40) navTexts.push(t); });
  const styleBlob = $('style').map((_, el) => $(el).text()).get().join('\n') + '\n' + ($('[style]').map((_, el) => $(el).attr('style') ?? '').get().join(';'));
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return {
    url, html, text, styles: null, images, icons,
    ogImage: abs($('meta[property="og:image"]').attr('content'), url),
    socialLinks: [...socialLinks], emails: [...emails], jsonLd, fontLinks, headings, navTexts,
    cssVars: brandCssVars(styleBlob + '\n' + html.slice(0, 200_000)),
  };
}
