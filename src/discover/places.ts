import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, env, loadScoring } from '../config.js';
import { fetchWithTimeout, HttpError, retry } from '../util/http.js';
import { log } from '../util/log.js';

export interface AddressComponent { longText?: string; shortText?: string; types?: string[] }
export interface PlaceResult {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  primaryType?: string;
  types?: string[];
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean };
  editorialSummary?: { text?: string };
  primaryTypeDisplayName?: { text?: string };
  reviews?: PlaceReview[];
  photos?: { name?: string; widthPx?: number; heightPx?: number }[];
}

export interface PlaceReview {
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
  authorAttribution?: { displayName?: string };
  publishTime?: string;
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.location',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.businessStatus', 'places.primaryType', 'places.types', 'places.googleMapsUri', 'places.regularOpeningHours',
  // Description and activity: Google's summary when it has one, the type label, and up to five reviews with dates.
  'places.editorialSummary', 'places.primaryTypeDisplayName', 'places.reviews', 'places.photos', 'nextPageToken',
].join(',');

export class BudgetExceeded extends Error {}

export interface Budget { used: number; max: number }

function cachePath(key: string) {
  const dir = join(CACHE_DIR, 'places');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${createHash('sha1').update(key).digest('hex')}.json`);
}

function readCache<T>(key: string, maxDays: number): T | null {
  const p = cachePath(key);
  if (!existsSync(p)) return null;
  try {
    const { at, data } = JSON.parse(readFileSync(p, 'utf8')) as { at: string; data: T };
    if ((Date.now() - new Date(at).getTime()) / 86_400_000 > maxDays) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown) {
  writeFileSync(cachePath(key), JSON.stringify({ at: new Date().toISOString(), data }));
}

async function placesPost<T>(url: string, body: unknown, fieldMask: string): Promise<T> {
  const key = env('GOOGLE_PLACES_API_KEY');
  return retry(async () => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      timeoutMs: 20000,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': fieldMask },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `Places API ${res.status}: ${text.slice(0, 300)}`, text);
    return JSON.parse(text) as T;
  }, { attempts: 1, baseMs: 2000, shouldRetry: (e) => e instanceof HttpError && (e.status === 429 || e.status >= 500) });
}

export interface SearchOpts {
  pages?: number;
  budget: Budget;
  dryRun?: boolean;
  onRequest?: () => void;
  /** Bias results towards a market's centre. Without one, Google goes by the words in the query alone. */
  centre?: { latitude: number; longitude: number };
  radiusM?: number;
}

/** Text Search (New) with pagination, cache and budget. Returns all places across pages. */
export async function searchText(textQuery: string, opts: SearchOpts): Promise<PlaceResult[]> {
  const pages = Number.isFinite(opts.pages) ? Math.min(Math.max(opts.pages as number, 1), 3) : 3;
  const cacheDays = loadScoring().thresholds.cache_days;
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;
  for (let page = 1; page <= pages; page++) {
    const cacheKey = `searchText:v3:${textQuery}:page${page}`;
    const cached = readCache<{ places?: PlaceResult[]; nextPageToken?: string }>(cacheKey, cacheDays);
    let data: { places?: PlaceResult[]; nextPageToken?: string };
    if (cached) {
      log.debug(`cache hit: ${textQuery} page ${page}`);
      data = cached;
    } else {
      if (opts.dryRun) {
        log.info(`[dry-run] would POST searchText "${textQuery}" page ${page}`);
        opts.budget.used++;
        break;
      }
      if (opts.budget.used >= opts.budget.max) throw new BudgetExceeded(`Places request budget of ${opts.budget.max} reached. Raise PLACES_MAX_REQUESTS_PER_RUN if intended.`);
      opts.budget.used++;
      opts.onRequest?.();
      const body: Record<string, unknown> = {
        textQuery,
        regionCode: 'GB',
        languageCode: 'en-GB',
        pageSize: 20,
      };
      if (opts.centre) body.locationBias = { circle: { center: opts.centre, radius: opts.radiusM ?? 15000 } };
      if (pageToken) body.pageToken = pageToken;
      data = await placesPost(SEARCH_URL, body, FIELD_MASK);
      writeCache(cacheKey, data);
    }
    results.push(...(data.places ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return results;
}

/** Place Details for review snippets. Higher-priced SKU, call only for shortlisted leads. */
export async function placeReviews(placeId: string, budget: Budget): Promise<PlaceReview[]> {
  const cacheKey = `details:${placeId}:reviews`;
  const cached = readCache<{ reviews?: PlaceReview[] }>(cacheKey, 30);
  if (cached) return cached.reviews ?? [];
  if (budget.used >= budget.max) throw new BudgetExceeded('Places request budget reached');
  budget.used++;
  const key = env('GOOGLE_PLACES_API_KEY');
  const res = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    timeoutMs: 20000,
    headers: { 'x-goog-api-key': key, 'x-goog-fieldmask': 'reviews' },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `Place Details ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { reviews?: PlaceReview[] };
  writeCache(cacheKey, data);
  return data.reviews ?? [];
}

export function postcodeOf(place: PlaceResult): string | null {
  const pc = place.addressComponents?.find((c) => c.types?.includes('postal_code'));
  const v = (pc?.longText ?? pc?.shortText ?? '').toUpperCase().trim();
  if (v) return v;
  const m = place.formattedAddress?.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i);
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

export function outwardCode(postcode: string | null): string | null {
  if (!postcode) return null;
  const m = postcode.toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return m ? m[1] : null;
}
