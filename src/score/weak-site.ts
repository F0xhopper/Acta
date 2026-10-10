/**
 * Signs that a live site is weak enough to replace. A business with one of these has already paid for a website
 * once, which says more about whether it will pay again than having none does. Pure.
 */
import type { Scoring } from '../config.js';
import type { AuditRow } from '../db/types.js';

export type WeakKey = 'no_viewport' | 'no_https' | 'slow' | 'cheap_builder' | 'free_tier' | 'stale';
export interface WeakSignal { key: WeakKey; label: string }

export function weakSiteSignals(audit: AuditRow | null | undefined, scoring: Scoring, now = new Date()): WeakSignal[] {
  if (!audit || audit.website_status !== 'live') return [];
  const out: WeakSignal[] = [];
  if (audit.has_viewport === 0) out.push({ key: 'no_viewport', label: 'not built for phones' });
  if (audit.https_ok === 0) out.push({ key: 'no_https', label: 'no HTTPS' });
  if (audit.lh_perf !== null && audit.lh_perf < scoring.thresholds.weak_site_perf_under) out.push({ key: 'slow', label: `slow on a phone (Lighthouse ${audit.lh_perf})` });
  if (audit.builder && scoring.cheap_builders.includes(audit.builder)) out.push({ key: 'cheap_builder', label: `built on ${audit.builder}` });
  if (audit.free_tier_host) out.push({ key: 'free_tier', label: 'on a free-tier address' });
  if (audit.copyright_year && now.getFullYear() - audit.copyright_year >= scoring.opportunity.live.copyright_stale_years) out.push({ key: 'stale', label: `untouched since ${audit.copyright_year}` });
  return out;
}

export const weakSiteSummary = (signals: WeakSignal[]) => signals.map((s) => s.label).join(', ');
