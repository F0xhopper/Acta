/**
 * Subscription usage, read from `claude -p /usage`. Claude Code has no machine-readable usage API on subscription
 * plans, but the headless /usage command prints the session and weekly percentages, which is enough for a guard.
 */
import { run } from './exec.js';

export interface Usage { session: number | null; week: number | null; raw: string; at: string }

export function parseUsage(text: string): Omit<Usage, 'raw' | 'at'> {
  const pct = (re: RegExp) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    session: pct(/Current session:\s*(\d+(?:\.\d+)?)%/i),
    week: pct(/Current week \(all models\):\s*(\d+(?:\.\d+)?)%/i) ?? pct(/Current week:\s*(\d+(?:\.\d+)?)%/i),
  };
}

export async function readUsage(): Promise<Usage | null> {
  const r = await run('claude', ['-p', '/usage', '--output-format', 'text'], { cwd: '/tmp', timeoutMs: 90_000 });
  const p = parseUsage(r.stdout);
  if (p.session === null && p.week === null) return null;
  return { ...p, raw: r.stdout, at: new Date().toISOString() };
}

/** The first limit at or over the threshold, or null. */
export function overLimit(u: Usage | Omit<Usage, 'raw' | 'at'>, threshold: number): string | null {
  if (u.session !== null && u.session >= threshold) return `session at ${u.session}%`;
  if (u.week !== null && u.week >= threshold) return `week at ${u.week}%`;
  return null;
}

export const usageThreshold = () => Number(process.env.ACTA_USAGE_STOP_PERCENT ?? 70);
