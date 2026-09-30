import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodePhotoUnderBudget } from './download.js';
import { CACHE_DIR } from '../../config.js';
import { fetchWithTimeout, HttpError } from '../../util/http.js';

export interface PlacePhoto { name: string; widthPx?: number; heightPx?: number; authorAttributions?: { displayName?: string }[] }
export interface PlaceDetails {
  photos?: PlacePhoto[];
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean; wheelchairAccessibleParking?: boolean };
  paymentOptions?: { acceptsCreditCards?: boolean; acceptsDebitCards?: boolean; acceptsNfc?: boolean };
  parkingOptions?: Record<string, boolean>;
  goodForChildren?: boolean;
  allowsDogs?: boolean;
  editorialSummary?: { text?: string };
  websiteUri?: string;
  internationalPhoneNumber?: string;
}

const FIELDS = 'photos,accessibilityOptions,paymentOptions,parkingOptions,goodForChildren,allowsDogs,editorialSummary,websiteUri,internationalPhoneNumber';

function cacheFile(key: string) {
  const dir = join(CACHE_DIR, 'place-details');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${createHash('sha1').update(key).digest('hex')}.json`);
}

export async function placeDetails(placeId: string, key: string, onRequest?: () => void, cacheDays = 7): Promise<PlaceDetails> {
  const f = cacheFile(`details:${placeId}:${FIELDS}`);
  if (existsSync(f)) {
    try {
      const { at, data } = JSON.parse(readFileSync(f, 'utf8')) as { at: string; data: PlaceDetails };
      if ((Date.now() - new Date(at).getTime()) / 86_400_000 <= cacheDays) return data;
    } catch { /* refetch */ }
  }
  onRequest?.();
  const res = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    timeoutMs: 20000, headers: { 'x-goog-api-key': key, 'x-goog-fieldmask': FIELDS },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `Place Details ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as PlaceDetails;
  writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), data }));
  return data;
}

/** Download one Places photo as a JPEG. Returns null when it's too small or fails. */
export async function downloadPlacePhoto(photo: PlacePhoto, key: string, dest: string, onRequest?: () => void): Promise<{ path: string; width: number; height: number; attribution: string | null } | null> {
  onRequest?.();
  const url = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1600&maxHeightPx=1600&key=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 30000, headers: { accept: 'image/*' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (!meta.width || meta.width < 600) return null;
  const out = await encodePhotoUnderBudget(Buffer.from(buf));
  writeFileSync(dest, out.data);
  return { path: dest, width: out.info.width, height: out.info.height, attribution: photo.authorAttributions?.[0]?.displayName ?? null };
}
