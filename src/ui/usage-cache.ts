/**
 * Claude usage for the UI. Reading it runs `claude -p /usage`, which takes seconds, so the value is
 * cached for two minutes and refreshed in the background: a request never waits for it.
 */
import { readUsage, usageThreshold } from '../build/usage.js';
import type { Usage } from './api-types.js';

let cached: Usage | null = null;
let readAt = 0;
let refreshing: Promise<void> | null = null;
const TTL = 2 * 60_000;

function refresh(): Promise<void> {
  refreshing ??= readUsage().then((u) => {
    const stopAt = usageThreshold();
    cached = u ? { session: u.session, week: u.week, stopAt, warnAt: Math.max(0, stopAt - 10), at: u.at } : null;
  }).catch(() => undefined).finally(() => { readAt = Date.now(); refreshing = null; });
  return refreshing;
}

/** The cached usage, starting a refresh when it's stale. `wait` waits for a first reading (used by the guard). */
export async function getUsage(opts: { wait?: boolean; force?: boolean } = {}): Promise<Usage | null> {
  const stale = Date.now() - readAt > TTL;
  if (opts.force || stale) {
    const p = refresh();
    if (opts.wait && (readAt === 0 || opts.force)) await Promise.race([p, new Promise((r) => setTimeout(r, 20_000))]);
  }
  return cached;
}

/** The limit the usage is over, or null. Unknown usage never blocks. */
export function overLimit(u: Usage | null): string | null {
  if (!u) return null;
  if (u.session !== null && u.session >= u.stopAt) return `the session is at ${Math.round(u.session)}%`;
  if (u.week !== null && u.week >= u.stopAt) return `the week is at ${Math.round(u.week)}%`;
  return null;
}

export function setUsageForTest(u: Usage | null) { cached = u; readAt = Date.now(); }
