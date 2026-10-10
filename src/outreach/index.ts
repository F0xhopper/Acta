/**
 * Outreach: sending pitches and follow-ups, recording contacts made by hand, scheduling follow-ups,
 * enforcing the warm-up cap and the compliance rules, and reporting whether sending is ready.
 * The UI server and the CLI both call these; nothing here runs on its own (see tick.ts for that).
 */
import { openDb } from '../db/index.js';
import { getFullLead, isSuppressed, setStatus } from '../db/queries.js';
import type { FullLead, PipelineStatus } from '../db/types.js';
import { loadOffer, readDelivery, senderMissing } from '../delivery/index.js';
import { getBuild } from '../build/queries.js';
import { loadOutreach, sendsForReal, TRANSPORT_LABEL, secrets, type OutreachConfig, type Transport } from './config.js';
import { checkDomain, type DnsCheck } from './dns.js';
import { contactsFor, dailyCap, domainOf, emailBlockers, followUpStatus, followUpText, localDay, nextTouch, warmupWeek } from './rules.js';
import { deleteMessage, emailsOn, firstEmailDay, getState, lastOut, messagesFor, recordMessage, setNextTouch, type MessageRow } from './store.js';
import { deliver } from './transport.js';
import { hookKind } from './hook.js';

export class OutreachError extends Error { constructor(message: string, public code: 'blocked' | 'cap' | 'config' | 'failed' | 'state' = 'blocked') { super(message); } }

const leadOr = (slug: string): FullLead => { const f = getFullLead(slug); if (!f) throw new OutreachError(`No business "${slug}"`, 'state'); return f; };

// ---------- status ----------

let dnsCache: { at: number; key: string; checks: DnsCheck[] } | null = null;
export async function dnsChecks(cfg = loadOutreach(), force = false): Promise<DnsCheck[]> {
  const key = `${cfg.fromAddress}|${cfg.transport}`;
  if (!force && dnsCache && dnsCache.key === key && Date.now() - dnsCache.at < 10 * 60_000) return dnsCache.checks;
  const checks = await checkDomain(domainOf(cfg.fromAddress), cfg.transport);
  dnsCache = { at: Date.now(), key, checks };
  return checks;
}

export interface CapState { today: number; sentToday: number; left: number; warmupWeek: number }
export function capState(cfg = loadOutreach(), now = new Date()): CapState {
  const first = firstEmailDay();
  const day = localDay(now);
  const today = dailyCap(cfg.cap, first, day);
  const sentToday = emailsOn(now);
  return { today, sentToday, left: Math.max(0, today - sentToday), warmupWeek: warmupWeek(first, day) };
}

/** Why Acta can't send real email right now. Empty means it can. */
export async function sendProblems(cfg = loadOutreach(), opts: { dns?: boolean } = {}): Promise<string[]> {
  const p: string[] = [];
  if (!sendsForReal(cfg.transport)) p.push(cfg.transport === 'test' ? 'Test mode: emails are written to out/outbox instead of being sent.' : 'Sending is by hand. Set transport to proton or resend in config/outreach.yaml for a Send button.');
  if (!cfg.fromAddress) p.push('No sending address. Fill in your email in config/offer.yaml.');
  const missing = senderMissing();
  if (missing.length) p.push(`Fill in your sender details in config/offer.yaml: ${missing.join(', ')}.`);
  const s = secrets();
  if (cfg.transport === 'proton' && (!s.bridgeUser || !s.bridgePassword)) p.push('Add PROTON_BRIDGE_USER and PROTON_BRIDGE_PASSWORD (from the Bridge app) to .env.');
  if (cfg.transport === 'resend' && !s.resendKey) p.push('Add RESEND_API_KEY to .env.');
  if (opts.dns !== false && sendsForReal(cfg.transport)) {
    for (const c of await dnsChecks(cfg)) if (!c.ok) p.push(`${c.name}: ${c.detail}`);
  }
  return p;
}

export async function outreachStatus() {
  const cfg = loadOutreach();
  const problems = await sendProblems(cfg);
  const real = sendsForReal(cfg.transport);
  return {
    transport: cfg.transport, transportLabel: TRANSPORT_LABEL[cfg.transport], from: cfg.fromAddress || null,
    sendsForReal: real, canSendNow: (real || cfg.transport === 'test') && problems.filter((x) => !x.startsWith('Test mode')).length === 0,
    problems,
    cap: capState(cfg),
    dns: cfg.fromAddress ? await dnsChecks(cfg) : null,
    followUps: { auto: cfg.follow_ups.auto, days: cfg.follow_ups.days, maxContacts: cfg.follow_ups.max_contacts },
    replies: { check: cfg.replies.check, lastCheckedAt: getState('replies_checked_at'), lastError: getState('replies_error'), matched: Number(getState('replies_matched') ?? 0) },
  };
}

// ---------- compliance ----------

function blockersFor(full: FullLead, to: string | null, body: string): string[] {
  const offer = loadOffer();
  return emailBlockers({
    status: full.pipeline.status, ltd: full.ch?.match_confidence === 'high', suppressed: isSuppressed(full.lead, full.audit?.final_domain),
    to, senderMissing: senderMissing(offer), body, postalAddress: /\[.*\]/.test(offer.sender.postal_address) ? '' : offer.sender.postal_address,
  });
}

/** Why the pitch email for a business can't be sent by Acta, in plain words. */
export function pitchBlockers(slug: string): string[] {
  const full = leadOr(slug);
  const del = readDelivery(slug);
  if (!del) return ['Generate the package first.'];
  return blockersFor(full, del.to ?? null, del.body);
}

// ---------- recording contacts and scheduling follow-ups ----------

/** When the first pitch went out, the clock follow-ups count from. */
function pitchedAt(full: FullLead): string | null {
  return lastOut(full.lead.id, ['pitch'])?.at ?? full.pipeline.contacted_at ?? null;
}

/** After a contact: move the status on and schedule the next follow-up (or none, after the last). */
function afterContact(full: FullLead, kind: 'pitch' | 'followup_1' | 'followup_2', channel: string, cfg: OutreachConfig) {
  const status: PipelineStatus = kind === 'pitch' ? 'contacted' : kind;
  setStatus(full.lead.slug, status, kind === 'pitch' ? `pitch sent by ${channel.replace('_', ' ')}` : `follow-up ${kind.slice(-1)} sent by ${channel.replace('_', ' ')}`);
  const fresh = getFullLead(full.lead.slug)!;
  const start = pitchedAt(fresh) ?? new Date().toISOString();
  setNextTouch(full.lead.id, nextTouch(cfg.follow_ups, start, contactsFor(status)));
}

/** Record a contact you made yourself (copied into your mail app, a call, a walk-in, a WhatsApp). */
export function logContact(slug: string, o: { kind: 'pitch' | 'followup_1' | 'followup_2'; channel: string; subject?: string | null; body?: string | null; to?: string | null }): MessageRow {
  const cfg = loadOutreach();
  const full = leadOr(slug);
  const m = recordMessage({
    lead_id: full.lead.id, slug, direction: 'out', kind: o.kind, channel: o.channel, to_addr: o.to ?? null, from_addr: cfg.fromAddress || null,
    subject: o.subject ?? null, body: o.body ?? null, transport: 'manual', status: 'logged', message_id: null, in_reply_to: null, provider_id: null, error: null,
    hook: hookKind(full.audit),
  });
  afterContact(full, o.kind, o.channel, cfg);
  return m;
}

/** Undo the last recorded pitch (a mis-click on "Mark as sent"). */
export function undoPitch(slug: string) {
  const full = leadOr(slug);
  const last = lastOut(full.lead.id, ['pitch']);
  if (last && last.transport === 'manual') deleteMessage(last.id);
  setNextTouch(full.lead.id, null);
}

/** Replies, wins and losses end the sequence. */
export function stopSequence(slug: string) { const full = getFullLead(slug); if (full) setNextTouch(full.lead.id, null); }

/** Record a follow-up the Overview "I followed up" button logs, so the next one is scheduled. */
export function onStatusChange(slug: string, status: string) {
  if (status === 'followup_1' || status === 'followup_2') {
    const cfg = loadOutreach();
    const full = leadOr(slug);
    const start = pitchedAt(full) ?? new Date().toISOString();
    setNextTouch(full.lead.id, nextTouch(cfg.follow_ups, start, contactsFor(status)));
  } else if (['replied', 'won', 'lost', 'do_not_contact', 'new', 'preview_ready'].includes(status)) stopSequence(slug);
}

// ---------- sending ----------

async function sendEmail(full: FullLead, kind: 'pitch' | 'followup_1' | 'followup_2', subject: string, body: string, opts: { override?: boolean; inReplyTo?: string | null } = {}): Promise<MessageRow> {
  const cfg = loadOutreach();
  const del = readDelivery(full.lead.slug);
  const to = del?.to ?? null;
  if (cfg.transport === 'manual') throw new OutreachError('Sending is by hand: copy the email into your mail app, then press Mark as sent.', 'config');
  const blockers = blockersFor(full, to, body);
  if (blockers.length) throw new OutreachError(blockers.join(' '), 'blocked');
  const problems = (await sendProblems(cfg)).filter((p) => !p.startsWith('Test mode'));
  if (problems.length) throw new OutreachError(problems.join(' '), 'config');
  const cap = capState(cfg);
  if (cap.left <= 0 && !opts.override) throw new OutreachError(`Today's warm-up limit of ${cap.today} emails is used. Sending more this early can push the domain into spam folders.`, 'cap');
  const r = await deliver(cfg, { to: to!, subject, body, inReplyTo: opts.inReplyTo ?? null, slug: full.lead.slug });
  const m = recordMessage({
    lead_id: full.lead.id, slug: full.lead.slug, direction: 'out', kind, channel: 'email', to_addr: to, from_addr: cfg.fromAddress, subject, body,
    transport: cfg.transport, status: r.status, message_id: r.messageId, in_reply_to: opts.inReplyTo ?? null, provider_id: r.providerId, error: r.error,
    hook: hookKind(full.audit),
  });
  if (r.status === 'failed') throw new OutreachError(`The email didn't send: ${r.error}`, 'failed');
  afterContact(full, kind, 'email', cfg);
  return m;
}

/** Send the approved pitch email through the configured transport. */
export async function sendPitch(slug: string, opts: { override?: boolean } = {}): Promise<MessageRow> {
  const full = leadOr(slug);
  const b = getBuild(full.lead.id);
  if (b?.state !== 'approved') throw new OutreachError('Approve the site before sending the pitch.', 'state');
  if (lastOut(full.lead.id, ['pitch'])) throw new OutreachError('The pitch has already been sent to this business.', 'state');
  const del = readDelivery(slug);
  if (!del) throw new OutreachError('Generate the package first.', 'state');
  return sendEmail(full, 'pitch', del.subject, del.body, opts);
}

// ---------- follow-ups ----------

export interface FollowUp { slug: string; name: string; n: 1 | 2; dueAt: string; overdue: boolean; channel: string; to: string | null; canEmail: boolean; subject: string; body: string; last: boolean }

/** The next follow-up for a business, if one is scheduled. */
export function followUpFor(full: FullLead, cfg = loadOutreach(), now = new Date()): FollowUp | null {
  const due = full.pipeline.next_touch_at;
  const contacts = contactsFor(full.pipeline.status);
  if (!due || contacts === 0 || contacts >= cfg.follow_ups.max_contacts) return null;
  const n = contacts as 1 | 2;
  const del = readDelivery(full.lead.slug);
  const offer = loadOffer();
  const pitch = lastOut(full.lead.id, ['pitch']);
  const t = followUpText(n, contacts + 1 >= cfg.follow_ups.max_contacts, {
    businessName: full.lead.name, previewUrl: del?.previewUrl ?? getBuild(full.lead.id)?.preview_url ?? '', senderName: offer.sender.name,
    tradingName: offer.sender.trading_name, postalAddress: offer.sender.postal_address, originalSubject: pitch?.subject ?? del?.subject ?? `The website I made for ${full.lead.name}`,
  });
  const channel = pitch?.channel ?? full.pipeline.channel ?? del?.channel ?? 'email';
  const to = del?.to ?? null;
  return {
    slug: full.lead.slug, name: full.lead.name, n, dueAt: due, overdue: Date.parse(due) <= now.getTime(), channel, to,
    canEmail: channel === 'email' && blockersFor(full, to, t.body).length === 0, subject: t.subject, body: t.body, last: contacts + 1 >= cfg.follow_ups.max_contacts,
  };
}

/** Send (or record, when you sent it yourself) the next follow-up for a business. */
export async function doFollowUp(slug: string, o: { mode: 'send' | 'logged'; subject?: string; body?: string; channel?: string; override?: boolean }): Promise<MessageRow> {
  const full = leadOr(slug);
  const f = followUpFor(full);
  if (!f) throw new OutreachError('No follow-up is due for this business.', 'state');
  const kind = followUpStatus(f.n);
  const subject = o.subject?.trim() || f.subject;
  const body = o.body?.trim() || f.body;
  if (o.mode === 'logged') return logContact(slug, { kind, channel: o.channel ?? f.channel, subject, body, to: f.to });
  return sendEmail(full, kind, subject, body, { override: o.override, inReplyTo: lastOut(full.lead.id, ['pitch', 'followup_1'])?.message_id ?? null });
}

export interface DueRow { slug: string; next_touch_at: string; status: string }
/** Every business with a follow-up due by `now`. */
export function dueFollowUps(now = new Date()): FollowUp[] {
  const cfg = loadOutreach();
  const list = dueRows(now);
  return list.map((r) => { const f = getFullLead(r.slug); return f ? followUpFor(f, cfg, now) : null; }).filter((x): x is FollowUp => !!x && x.overdue);
}
function dueRows(now: Date): DueRow[] {
  return openDb().prepare(`SELECT l.slug, p.next_touch_at, p.status FROM pipeline p JOIN leads l ON l.id = p.lead_id
    WHERE p.next_touch_at IS NOT NULL AND p.next_touch_at <= ? AND p.status IN ('contacted','followup_1','followup_2') ORDER BY p.next_touch_at`).all(now.toISOString()) as unknown as DueRow[];
}

export { type Transport, sendsForReal };
