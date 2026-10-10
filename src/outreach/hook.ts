/**
 * The hook a pitch leads with, as one word, so outcomes can be read by hook: did "your site is down" get more
 * replies than "you have no website"? Pure: from the audit alone.
 */
import type { AuditRow } from '../db/types.js';

export type HookKind = 'none' | 'down' | 'broken' | 'facebook_only' | 'directory_only' | 'platform_only'
  | 'no_viewport' | 'slow' | 'no_https' | 'cheap_builder' | 'stale' | 'weak' | 'unknown';

export const CHEAP_BUILDERS = new Set(['wix', 'godaddy', 'weebly', 'jimdo', 'yell', 'ueni', 'site123', 'strikingly']);
const STALE_YEARS = 3;

export function hookKind(audit: Pick<AuditRow, 'website_status' | 'has_viewport' | 'lh_perf' | 'https_ok' | 'builder' | 'copyright_year'> | null | undefined, year = new Date().getFullYear()): HookKind {
  if (!audit) return 'unknown';
  const s = audit.website_status;
  if (s !== 'live') return (['none', 'down', 'broken', 'facebook_only', 'directory_only', 'platform_only'] as const).includes(s as never) ? (s as HookKind) : 'unknown';
  if (audit.has_viewport === 0) return 'no_viewport';
  if (audit.lh_perf !== null && audit.lh_perf !== undefined && audit.lh_perf < 50) return 'slow';
  if (audit.https_ok === 0) return 'no_https';
  if (audit.builder && CHEAP_BUILDERS.has(audit.builder)) return 'cheap_builder';
  if (audit.copyright_year && year - audit.copyright_year >= STALE_YEARS) return 'stale';
  return 'weak';
}

export const HOOK_LABEL: Record<HookKind, string> = {
  none: 'No website', down: 'Site down', broken: 'Site broken', facebook_only: 'Social page only', directory_only: 'Directory only', platform_only: 'Booking page only',
  no_viewport: 'Not mobile friendly', slow: 'Slow on phones', no_https: 'No HTTPS', cheap_builder: 'Cheap builder', stale: 'Looks unmaintained', weak: 'Weak site', unknown: 'Unknown',
};
