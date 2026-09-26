import type { Scoring } from '../config.js';
import type { WebsiteStatus } from '../db/types.js';
import { hostMatches, hostOf } from '../util/http.js';

export type UrlClass = { status: 'none' | 'facebook_only' | 'directory_only' | 'platform_only'; host: string | null } | { status: 'fetch'; host: string; url: string };

export function normaliseUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

/** Decide from the URL alone whether a fetch is even worthwhile. */
export function classifyUrl(url: string | null | undefined, scoring: Scoring): UrlClass {
  if (!url || !url.trim()) return { status: 'none', host: null };
  const normalised = normaliseUrl(url);
  const host = hostOf(normalised);
  if (!host) return { status: 'none', host: null };
  if (hostMatches(host, scoring.hosts.social)) return { status: 'facebook_only', host };
  if (hostMatches(host, scoring.hosts.directory)) return { status: 'directory_only', host };
  if (hostMatches(host, scoring.hosts.platform)) return { status: 'platform_only', host };
  return { status: 'fetch', host, url: normalised };
}

export interface FetchOutcome { httpStatus: number | null; error: string | null; tlsError: string | null; redirectLoop: boolean; body: string; contentType: string | null }

/** Decide down / broken / live from what came back. */
export function classifyFetch(f: FetchOutcome, scoring: Scoring): Extract<WebsiteStatus, 'down' | 'broken' | 'live'> {
  if (f.tlsError) return 'broken';
  if (f.redirectLoop) return 'broken';
  if (f.error) return 'down';
  if (f.httpStatus === null) return 'down';
  if (f.httpStatus >= 500) return 'down';
  if (f.httpStatus >= 400) return 'broken';
  if (f.httpStatus >= 300) return 'broken';
  if (looksParked(f.body, scoring.parked_phrases)) return 'broken';
  if (f.contentType && !/html|xml|text/i.test(f.contentType)) return 'broken';
  if (f.body.trim().length < 200) return 'broken';
  return 'live';
}

/** Parked-domain detection on visible text only (scripts and styles stripped), matching whole phrases. */
export function looksParked(body: string, phrases: string[]): boolean {
  const visible = body
    .slice(0, 300_000)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return phrases.some((p) => {
    const esc = p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(visible);
  });
}
