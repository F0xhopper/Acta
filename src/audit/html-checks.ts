import * as cheerio from 'cheerio';
import type { Scoring } from '../config.js';
import { findUkPhones } from '../util/phone.js';
import { hostMatches } from '../util/http.js';

export interface HtmlChecks {
  hasViewport: boolean;
  title: string | null;
  titleLen: number;
  metaDescLen: number;
  h1Count: number;
  builder: string | null;
  freeTierHost: boolean;
  copyrightYear: number | null;
  phonesOnPage: string[];
  phoneMatchesListing: boolean | null;
  hasLocalSchema: boolean;
  ltdHint: boolean;
  description: string | null;
}

export function runHtmlChecks(body: string, headers: Record<string, string>, finalDomain: string | null, listingPhone: string | null, scoring: Scoring): HtmlChecks {
  const $ = cheerio.load(body);
  const lower = body.toLowerCase();
  const headerBlob = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n').toLowerCase();
  const viewport = $('meta[name="viewport"]').attr('content') ?? '';
  const title = $('title').first().text().replace(/\s+/g, ' ').trim() || null;
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const text = $('body').text().replace(/\s+/g, ' ');

  let builder: string | null = null;
  for (const b of scoring.builders) {
    if (b.patterns.some((p) => lower.includes(p.toLowerCase()) || headerBlob.includes(p.toLowerCase()))) { builder = b.key; break; }
  }
  const freeTierHost = hostMatches(finalDomain, scoring.hosts.free_tier);

  let copyrightYear: number | null = null;
  for (const m of text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)) {
    const y = Number.parseInt(m[1], 10);
    if (y >= 1995 && y <= new Date().getFullYear() + 1 && (copyrightYear === null || y > copyrightYear)) copyrightYear = y;
  }

  const phones = new Set<string>(findUkPhones(text));
  $('a[href^="tel:"]').each((_, a) => { for (const p of findUkPhones($(a).attr('href')!.replace('tel:', ''))) phones.add(p); });
  const phonesOnPage = [...phones];
  // No phones on the page means we can't tell, not a mismatch.
  const phoneMatchesListing = listingPhone && phonesOnPage.length ? phonesOnPage.includes(listingPhone) : null;

  let hasLocalSchema = false;
  const wanted = new Set(scoring.local_schema_types.map((t) => t.toLowerCase()));
  $('script[type="application/ld+json"]').each((_, s) => {
    const raw = $(s).contents().text();
    const types = [...raw.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    if (types.some((t) => wanted.has(t))) hasLocalSchema = true;
  });

  const footer = ($('footer').text() + ' ' + text.slice(-1500)).toLowerCase();
  const ltdHint = /\b(ltd|limited)\b/.test(footer) || /company\s*(no|number|reg)/.test(footer) || /registered in england/.test(footer);

  const description = extractDescription($);

  return {
    description,
    hasViewport: isMobileViewport($('meta[name="viewport"]').map((_, m) => $(m).attr('content') ?? '').get()),
    title, titleLen: title?.length ?? 0, metaDescLen: metaDesc.length, h1Count: $('h1').length,
    builder, freeTierHost, copyrightYear, phonesOnPage, phoneMatchesListing, hasLocalSchema, ltdHint,
  };
}

/** device-width, or a fixed phone-width layout like Wix's width=320 mobile site. */
export function isMobileViewport(contents: string[]): boolean {
  return contents.some((c) => {
    if (/width\s*=\s*device-width/i.test(c)) return true;
    const m = c.match(/width\s*=\s*(\d{3,4})/i);
    return !!m && Number(m[1]) <= 480;
  });
}

const JUNK_DESC = /just another wordpress site|lorem ipsum|coming soon|under construction|^home$|^welcome$|powered by|enable javascript|cookie|^untitled/i;

export function cleanDescription(t: string | undefined | null): string | null {
  const c = (t ?? '').replace(/\s+/g, ' ').trim();
  if (c.length < 40 || JUNK_DESC.test(c)) return null;
  return c.length > 300 ? `${c.slice(0, 297).replace(/\s+\S*$/, '')}…` : c;
}

/** The business describing itself: meta description, then Open Graph, then the first real paragraph. */
function extractDescription($: cheerio.CheerioAPI): string | null {
  const meta = cleanDescription($('meta[name="description"]').attr('content')) ?? cleanDescription($('meta[property="og:description"]').attr('content'));
  if (meta) return meta;
  let para: string | null = null;
  $('main p, article p, section p, body p').each((_, p) => {
    if (para) return;
    const t = $(p).text();
    if (t.replace(/\s+/g, ' ').trim().length >= 80) para = cleanDescription(t);
  });
  return para;
}
