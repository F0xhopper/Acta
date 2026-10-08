/** Outreach records: every message sent, logged or received, and a little key-value state. */
import { openDb } from '../db/index.js';
import { isoNow } from '../util/dates.js';
import { localDay } from './rules.js';

export interface MessageRow {
  id: number; lead_id: number; slug: string; direction: 'out' | 'in'; kind: string; channel: string;
  to_addr: string | null; from_addr: string | null; subject: string | null; body: string | null;
  transport: string; status: string; message_id: string | null; in_reply_to: string | null; provider_id: string | null; error: string | null; at: string;
}
const d = () => openDb();

export function recordMessage(m: Omit<MessageRow, 'id' | 'at'> & { at?: string }): MessageRow {
  const at = m.at ?? isoNow();
  const r = d().prepare(`INSERT INTO outreach_messages (lead_id, slug, direction, kind, channel, to_addr, from_addr, subject, body, transport, status, message_id, in_reply_to, provider_id, error, at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.lead_id, m.slug, m.direction, m.kind, m.channel, m.to_addr, m.from_addr, m.subject, m.body, m.transport, m.status, m.message_id, m.in_reply_to, m.provider_id, m.error, at);
  return d().prepare('SELECT * FROM outreach_messages WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as MessageRow;
}
export const messagesFor = (leadId: number) => d().prepare('SELECT * FROM outreach_messages WHERE lead_id = ? ORDER BY at DESC, id DESC').all(leadId) as unknown as MessageRow[];
export const deleteMessage = (id: number) => { d().prepare('DELETE FROM outreach_messages WHERE id = ?').run(id); };
export const lastOut = (leadId: number, kinds: string[]) =>
  d().prepare(`SELECT * FROM outreach_messages WHERE lead_id = ? AND direction = 'out' AND status != 'failed' AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY at DESC, id DESC LIMIT 1`).get(leadId, ...kinds) as unknown as MessageRow | undefined;
export const byMessageId = (ids: string[]) => {
  const clean = ids.map((x) => x.trim()).filter(Boolean);
  if (!clean.length) return undefined;
  return d().prepare(`SELECT * FROM outreach_messages WHERE direction = 'out' AND message_id IN (${clean.map(() => '?').join(',')}) LIMIT 1`).get(...clean) as unknown as MessageRow | undefined;
};
export const seenInbound = (messageId: string) => !!d().prepare("SELECT 1 FROM outreach_messages WHERE direction = 'in' AND message_id = ?").get(messageId);

const COUNTED = "direction = 'out' AND channel = 'email' AND status IN ('sent','logged','written')";
/** Emails counted against the warm-up cap on the local day of `now`. */
export function emailsOn(now: Date): number {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return (d().prepare(`SELECT COUNT(*) n FROM outreach_messages WHERE ${COUNTED} AND at >= ? AND at < ?`).get(start.toISOString(), end.toISOString()) as { n: number }).n;
}
/** The local day of the first email ever sent, which starts the warm-up. */
export function firstEmailDay(): string | null {
  const r = d().prepare(`SELECT MIN(at) t FROM outreach_messages WHERE ${COUNTED}`).get() as { t: string | null };
  return r.t ? localDay(new Date(r.t)) : null;
}

export function getState(key: string): string | null {
  return (d().prepare('SELECT value FROM outreach_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}
export function setState(key: string, value: string) {
  d().prepare('INSERT INTO outreach_state (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, isoNow());
}

export function setNextTouch(leadId: number, at: string | null) {
  d().prepare('UPDATE pipeline SET next_touch_at = ? WHERE lead_id = ?').run(at, leadId);
}
