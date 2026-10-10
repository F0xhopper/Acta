/**
 * Preview opens: each preview site counts its own opens in a shared Upstash Redis (the route in the starter,
 * src/app/api/seen/route.ts), and this reads the counts back into the preview_opens table. "Opened but no reply"
 * and "never opened" are different problems: the first is the offer, the second is reach.
 */
import { openDb } from '../db/index.js';
import { listBuilds } from '../build/queries.js';
import { isoNow } from '../util/dates.js';
import { fetchWithTimeout } from '../util/http.js';

export interface Opens { opens: number; firstAt: string | null; lastAt: string | null; checkedAt: string }
export interface OpensRow extends Opens { slug: string; name: string }

/** Same list as the starter's beacon (starter/src/kit/seen.tsx): automation and link-preview fetchers never count. */
export const BOT_UA = /Lighthouse|HeadlessChrome|bot|crawler|spider|WhatsApp|facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|Google-PageSpeed|curl|node/i;
export const isBotUserAgent = (ua: string | null | undefined) => BOT_UA.test(ua ?? '');

export const opensEnv = () => ({ url: (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/$/, ''), token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '' });
export const opensConfigured = () => { const e = opensEnv(); return !!(e.url && e.token); };
export const OPENS_HINT = 'Preview opens aren\'t counted: add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to .env';

export const opensKeys = (slug: string) => [`seen:${slug}`, `seen_first:${slug}`, `seen_last:${slug}`];

/** The three values Upstash returns for a slug (a pipeline of GETs: [{result}, {result}, {result}]). Pure. */
export function parseOpens(results: unknown): Omit<Opens, 'checkedAt'> {
  const arr = Array.isArray(results) ? results : [];
  const val = (i: number): string | null => {
    const r = arr[i] as { result?: unknown } | undefined;
    const v = r && typeof r === 'object' && 'result' in r ? r.result : r;
    return v === null || v === undefined ? null : String(v);
  };
  const n = Number.parseInt(val(0) ?? '0', 10);
  const iso = (s: string | null) => (s && !Number.isNaN(Date.parse(s)) ? s : null);
  return { opens: Number.isFinite(n) && n > 0 ? n : 0, firstAt: iso(val(1)), lastAt: iso(val(2)) };
}

async function fetchOpens(slug: string): Promise<Omit<Opens, 'checkedAt'>> {
  const { url, token } = opensEnv();
  const res = await fetchWithTimeout(`${url}/pipeline`, {
    method: 'POST', timeoutMs: 10_000, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(opensKeys(slug).map((k) => ['GET', k])),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return parseOpens(await res.json());
}

const d = () => openDb();

export function opensFor(leadId: number): Opens | null {
  const r = d().prepare('SELECT opens, first_at, last_at, checked_at FROM preview_opens WHERE lead_id = ?').get(leadId) as { opens: number; first_at: string | null; last_at: string | null; checked_at: string } | undefined;
  return r ? { opens: r.opens, firstAt: r.first_at, lastAt: r.last_at, checkedAt: r.checked_at } : null;
}

/** Read the counters for every deployed preview (or the slugs given) and store them. */
export async function refreshOpens(opts: { slugs?: string[] } = {}): Promise<{ refreshed: number; errors: string[]; note: string | null; rows: OpensRow[] }> {
  const rows: OpensRow[] = [];
  if (!opensConfigured()) return { refreshed: 0, errors: [], note: OPENS_HINT, rows };
  const builds = listBuilds().filter((b) => b.preview_url && b.state !== 'torn_down' && (!opts.slugs?.length || opts.slugs.includes(b.slug)));
  const errors: string[] = [];
  const now = isoNow();
  for (const b of builds) {
    try {
      const o = await fetchOpens(b.slug);
      d().prepare(`INSERT INTO preview_opens (lead_id, opens, first_at, last_at, checked_at) VALUES (?,?,?,?,?)
        ON CONFLICT(lead_id) DO UPDATE SET opens = excluded.opens, first_at = excluded.first_at, last_at = excluded.last_at, checked_at = excluded.checked_at`)
        .run(b.lead_id, o.opens, o.firstAt, o.lastAt, now);
      rows.push({ slug: b.slug, name: b.name, ...o, checkedAt: now });
    } catch (e) { errors.push(`${b.slug}: ${(e as Error).message}`); }
  }
  return { refreshed: rows.length, errors, note: null, rows };
}

/** One plain line for the UI and the CLI. Pure. */
export function opensLine(o: Opens | null, tracked: boolean, ago: (iso: string) => string = (iso) => iso.slice(0, 10)): string {
  if (!tracked) return OPENS_HINT;
  if (!o || o.opens === 0) return 'Not opened yet';
  return `Preview opened ${o.opens === 1 ? 'once' : `${o.opens} times`}${o.lastAt ? `, last ${ago(o.lastAt)}` : ''}`;
}
