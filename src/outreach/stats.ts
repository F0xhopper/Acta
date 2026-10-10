/**
 * What's working: every pitch sent, grouped by trade, by channel and by the hook it led with, with how many were
 * opened, replied to and won. The numbers the picker's learning should eventually run on; for now, a table to read.
 */
import { openDb } from '../db/index.js';
import { HOOK_LABEL, type HookKind } from './hook.js';
import { opensConfigured } from './opens.js';

export interface StatRow { key: string; label: string; pitched: number; opened: number; replied: number; won: number }
export interface OutreachStats { overall: StatRow; byTrade: StatRow[]; byChannel: StatRow[]; byHook: StatRow[]; opensTracked: boolean }

/** One row per business pitched: its trade, the channel and hook of the first pitch, where it stands now, and opens. */
export interface PitchFact { category_key: string; channel: string; hook: string | null; status: string; opens: number }

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', phone: 'Phone', walk_in: 'Walk in', whatsapp: 'WhatsApp', dm: 'DM' };
const tradeLabel = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Group pitch facts by a key. Pure. */
export function tally(facts: PitchFact[], keyOf: (f: PitchFact) => string, labelOf: (k: string) => string): StatRow[] {
  const m = new Map<string, StatRow>();
  for (const f of facts) {
    const k = keyOf(f);
    const r = m.get(k) ?? { key: k, label: labelOf(k), pitched: 0, opened: 0, replied: 0, won: 0 };
    r.pitched++;
    if (f.opens > 0) r.opened++;
    if (f.status === 'replied' || f.status === 'won') r.replied++;
    if (f.status === 'won') r.won++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.pitched - a.pitched || a.label.localeCompare(b.label));
}

export function pitchFacts(): PitchFact[] {
  return openDb().prepare(`SELECT l.category_key, m.channel, m.hook, p.status, COALESCE(o.opens, 0) opens
    FROM outreach_messages m JOIN leads l ON l.id = m.lead_id JOIN pipeline p ON p.lead_id = m.lead_id LEFT JOIN preview_opens o ON o.lead_id = m.lead_id
    WHERE m.id IN (SELECT MIN(id) FROM outreach_messages WHERE direction = 'out' AND kind = 'pitch' AND status != 'failed' GROUP BY lead_id)`).all() as unknown as PitchFact[];
}

export function outreachStats(facts = pitchFacts()): OutreachStats {
  const overall = tally(facts, () => 'all', () => 'All pitches')[0] ?? { key: 'all', label: 'All pitches', pitched: 0, opened: 0, replied: 0, won: 0 };
  return {
    overall,
    byTrade: tally(facts, (f) => f.category_key, tradeLabel),
    byChannel: tally(facts, (f) => f.channel, (k) => CHANNEL_LABEL[k] ?? k),
    byHook: tally(facts, (f) => f.hook ?? 'unknown', (k) => HOOK_LABEL[k as HookKind] ?? k),
    opensTracked: opensConfigured(),
  };
}

/** Three small tables for the terminal. Pure. */
export function formatStats(s: OutreachStats): string {
  const table = (title: string, rows: StatRow[]) => {
    if (!rows.length) return `${title}: no pitches yet`;
    const w = Math.max(12, ...rows.map((r) => r.label.length));
    const line = (r: StatRow) => `  ${r.label.padEnd(w)}  ${String(r.pitched).padStart(7)}  ${String(r.opened).padStart(6)}  ${String(r.replied).padStart(7)}  ${String(r.won).padStart(3)}`;
    return [`${title}`, `  ${'' .padEnd(w)}  pitched  opened  replied  won`, ...rows.map(line)].join('\n');
  };
  const pct = (n: number, of: number) => (of ? ` (${Math.round((100 * n) / of)}%)` : '');
  const o = s.overall;
  return [
    `${o.pitched} pitched, ${o.opened} opened${pct(o.opened, o.pitched)}, ${o.replied} replied${pct(o.replied, o.pitched)}, ${o.won} won${pct(o.won, o.pitched)}.`,
    s.opensTracked ? '' : 'Opens are not counted: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.',
    '', table('By trade', s.byTrade), '', table('By channel', s.byChannel), '', table('By hook', s.byHook),
  ].filter((l, i) => l !== '' || i > 1).join('\n');
}
