import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, env } from '../config.js';
import { fetchWithTimeout, HttpError, retry, sleep } from '../util/http.js';

const BASE = 'https://api.company-information.service.gov.uk';
const MIN_GAP_MS = 600;
let lastCall = 0;

export interface CHSearchItem {
  title: string;
  company_number: string;
  company_status?: string;
  company_type?: string;
  address?: { postal_code?: string; locality?: string };
  address_snippet?: string;
  date_of_creation?: string;
}

export interface CHProfile {
  company_number: string;
  company_name: string;
  company_status?: string;
  type?: string;
  sic_codes?: string[];
  registered_office_address?: { postal_code?: string };
}

function cacheFile(key: string) {
  const dir = join(CACHE_DIR, 'ch');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${createHash('sha1').update(key).digest('hex')}.json`);
}

async function chGet<T>(path: string, cacheKey: string, cacheDays: number, onRequest?: () => void): Promise<T> {
  const f = cacheFile(cacheKey);
  if (existsSync(f)) {
    try {
      const { at, data } = JSON.parse(readFileSync(f, 'utf8')) as { at: string; data: T };
      if ((Date.now() - new Date(at).getTime()) / 86_400_000 <= cacheDays) return data;
    } catch { /* fall through */ }
  }
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  onRequest?.();
  const auth = Buffer.from(`${env('COMPANIES_HOUSE_API_KEY')}:`).toString('base64');
  const data = await retry(async () => {
    const res = await fetchWithTimeout(`${BASE}${path}`, { timeoutMs: 15000, headers: { authorization: `Basic ${auth}`, accept: 'application/json' } });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `Companies House ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }, { attempts: 1, baseMs: 3000, shouldRetry: (e) => e instanceof HttpError && (e.status === 429 || e.status >= 500) });
  writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), data }));
  return data;
}

export async function searchCompanies(name: string, onRequest?: () => void): Promise<CHSearchItem[]> {
  const q = encodeURIComponent(name);
  const data = await chGet<{ items?: CHSearchItem[] }>(`/search/companies?q=${q}&items_per_page=10`, `search:${name.toLowerCase()}`, 30, onRequest);
  return data.items ?? [];
}

export async function getCompanyProfile(number: string, onRequest?: () => void): Promise<CHProfile> {
  return chGet<CHProfile>(`/company/${encodeURIComponent(number)}`, `profile:${number}`, 30, onRequest);
}
