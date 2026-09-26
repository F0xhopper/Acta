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
  const phoneMatchesListing = listingPhone ? phonesOnPage.includes(listingPhone) : null;

  let hasLocalSchema = false;
  const wanted = new Set(scoring.local_schema_types.map((t) => t.toLowerCase()));
  $('script[type="application/ld+json"]').each((_, s) => {
    const raw = $(s).contents().text();
    const types = [...raw.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    if (types.some((t) => wanted.has(t))) hasLocalSchema = true;
  });

  const footer = ($('footer').text() + ' ' + text.slice(-1500)).toLowerCase();
  const ltdHint = /\b(ltd|limited)\b/.test(footer) || /company\s*(no|number|reg)/.test(footer) || /registered in england/.test(footer);

  return {
    hasViewport: /width\s*=\s*device-width/i.test(viewport),
    title, titleLen: title?.length ?? 0, metaDescLen: metaDesc.length, h1Count: $('h1').length,
    builder, freeTierHost, copyrightYear, phonesOnPage, phoneMatchesListing, hasLocalSchema, ltdHint,
  };
}
