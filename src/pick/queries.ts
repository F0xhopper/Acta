import { openDb } from '../db/index.js';
import { isoNow } from '../util/dates.js';

const d = () => openDb();

export function recordPick(leadId: number, by: 'auto' | 'manual', reason: string, pickScore: number | null, buildability: number | null) {
  d().prepare('INSERT OR REPLACE INTO picks (lead_id, picked_at, picked_by, reason, pick_score, buildability) VALUES (?,?,?,?,?,?)').run(leadId, isoNow(), by, reason, pickScore, buildability);
}
export function removePick(leadId: number) { d().prepare('DELETE FROM picks WHERE lead_id = ?').run(leadId); }

export type ConsentAnswer = 'yes' | 'no';
export interface Consent { answer: ConsentAnswer; at: string; note: string | null }
/** What they said on the call before the build (the call checkpoint). */
export function consentOf(leadId: number): Consent | null {
  const r = d().prepare('SELECT consent, consent_at, consent_note FROM picks WHERE lead_id = ?').get(leadId) as { consent: string | null; consent_at: string | null; consent_note: string | null } | undefined;
  return r?.consent ? { answer: r.consent as ConsentAnswer, at: r.consent_at ?? '', note: r.consent_note } : null;
}
export function recordConsent(leadId: number, answer: ConsentAnswer, note: string | null) {
  d().prepare('UPDATE picks SET consent = ?, consent_at = ?, consent_note = ? WHERE lead_id = ?').run(answer, isoNow(), note, leadId);
}

/** Picks made in the last seven days, with what's needed for the diversity caps. */
export function picksThisWeek(): { lead_id: number; category_key: string; area: string }[] {
  return d().prepare(`SELECT p.lead_id, l.category_key, l.area FROM picks p JOIN leads l ON l.id = p.lead_id WHERE p.picked_at >= ?`)
    .all(new Date(Date.now() - 7 * 86_400_000).toISOString()) as unknown as { lead_id: number; category_key: string; area: string }[];
}

/** Reply and win rates by category from the pipeline statuses, for the picker's slow learning. */
export function outcomeStats(): { category_key: string; contacted: number; positive: number }[] {
  return d().prepare(`SELECT l.category_key, COUNT(*) contacted, SUM(CASE WHEN p.status IN ('replied','won') THEN 1 ELSE 0 END) positive
    FROM pipeline p JOIN leads l ON l.id = p.lead_id WHERE p.status IN ('contacted','followup_1','followup_2','replied','won','lost') GROUP BY l.category_key`)
    .all() as unknown as { category_key: string; contacted: number; positive: number }[];
}
