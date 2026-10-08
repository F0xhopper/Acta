/**
 * The outreach rules, as pure functions so they can be tested without a database, a network or a clock:
 * the warm-up cap, the send window, when follow-ups are due, what they say, who may be emailed, and how
 * to read a reply.
 */
import type { OutreachConfig } from './config.js';

// ---------- warm-up cap ----------

/** Emails allowed on `day`, given the day of the first email. Starts low, rises weekly, never above the max. */
export function dailyCap(cap: OutreachConfig['cap'], firstSendDay: string | null, day: string): number {
  if (!firstSendDay) return cap.start_per_day;
  const weeks = Math.max(0, Math.floor((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${firstSendDay}T12:00:00Z`)) / (7 * 86_400_000)));
  return Math.min(cap.max_per_day, cap.start_per_day + weeks * cap.increase_per_week);
}
export const warmupWeek = (firstSendDay: string | null, day: string) =>
  firstSendDay ? Math.floor((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${firstSendDay}T12:00:00Z`)) / (7 * 86_400_000)) + 1 : 1;

/** Local calendar day (YYYY-MM-DD) for a date. The cap and the window follow your clock, not UTC. */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- send window ----------

/** Whether `now` (local time) is inside the window Acta may send in on its own. */
export function inWindow(w: OutreachConfig['send_window'], now: Date): boolean {
  const iso = now.getDay() === 0 ? 7 : now.getDay();
  if (!w.days.includes(iso)) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return mins >= toMin(w.from) && mins < toMin(w.to);
}

// ---------- follow-ups ----------

export type ContactStatus = 'contacted' | 'followup_1' | 'followup_2';
/** Contacts made so far for a pipeline status: the pitch counts as one. */
export const contactsFor = (status: string) => (status === 'contacted' ? 1 : status === 'followup_1' ? 2 : status === 'followup_2' ? 3 : 0);

/**
 * When the next follow-up is due after a contact, or null when there should be no more.
 * `contacts` is the number made including the one just made; days are counted from the first pitch.
 */
export function nextTouch(f: OutreachConfig['follow_ups'], pitchedAt: string, contacts: number): string | null {
  if (contacts >= f.max_contacts) return null;
  const day = f.days[contacts - 1];
  if (day === undefined) return null;
  return new Date(Date.parse(pitchedAt) + day * 86_400_000).toISOString();
}

/** The status a follow-up moves a business to. */
export const followUpStatus = (n: number): 'followup_1' | 'followup_2' => (n === 1 ? 'followup_1' : 'followup_2');

export interface FollowUpInput { businessName: string; previewUrl: string; senderName: string; tradingName: string; postalAddress: string; originalSubject: string }

/** The follow-up text: short, one link, the same opt-out and address as the pitch. The last one says it's the last. */
export function followUpText(n: number, last: boolean, i: FollowUpInput): { subject: string; body: string } {
  const name = i.businessName.replace(/[\s,]+(ltd\.?|limited|llp|plc)$/i, '').trim();
  const lines = last
    ? ['Hi again,', '', `Last note from me on this. The site I made for ${name} stays up for a couple more weeks if you'd like a look:`, '', i.previewUrl, '', "If now isn't the right time, no problem at all."]
    : ['Hi again,', '', `Just checking you saw the site I made for ${name}:`, '', i.previewUrl, '', "Happy to change anything, or leave it if now isn't the time."];
  const body = [...lines, '', i.senderName, '', `${i.tradingName}, ${i.postalAddress}. Reply "no thanks" and I won't contact you again.`].join('\n');
  const subject = /^re:/i.test(i.originalSubject) ? i.originalSubject : `Re: ${i.originalSubject}`;
  return { subject: n > 0 ? subject : i.originalSubject, body };
}

// ---------- who may be emailed ----------

export interface EmailCheck { status: string; ltd: boolean; suppressed: boolean; to: string | null; senderMissing: string[]; body: string; postalAddress: string }

/** Every reason an email must not go out, in plain words. Empty means it may be sent. */
export function emailBlockers(c: EmailCheck): string[] {
  const out: string[] = [];
  if (!c.ltd) out.push('Not a limited company: UK rules (PECR) need consent before cold-emailing a sole trader. Call, walk in or use WhatsApp instead.');
  if (c.suppressed || c.status === 'do_not_contact' || c.status === 'lost') out.push('This business is on the do-not-contact list.');
  if (c.status === 'replied' || c.status === 'won') out.push('They have already replied, so automatic messages have stopped.');
  if (!c.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.to)) out.push('There is no email address for this business.');
  if (c.senderMissing.length) out.push(`Fill in your sender details in config/offer.yaml first: ${c.senderMissing.join(', ')}.`);
  if (!/won't contact you again|unsubscribe|opt out/i.test(c.body)) out.push('The email needs the opt-out line ("Reply no thanks and I won\'t contact you again").');
  if (c.postalAddress && !c.body.includes(c.postalAddress)) out.push('The email needs your postal address at the foot.');
  return out;
}

// ---------- replies ----------

/** Words that mean "stop". A reply containing them puts the business on the do-not-contact list. */
const STOP = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|messaging)|do not (email|contact)|don'?t (email|contact)|no thanks|no thank you|not interested)\b/i;
/** Automatic replies that are not a real answer. */
const AUTO = /\b(out of (the )?office|auto(matic)?[- ]?reply|on (annual )?leave|away until|delivery status notification|undeliverable|mail delivery (failed|subsystem))\b/i;

export type ReplyKind = 'stop' | 'reply' | 'auto';
export function classifyReply(subject: string, text: string): ReplyKind {
  const head = `${subject}\n${firstLines(text)}`;
  if (AUTO.test(head)) return 'auto';
  if (STOP.test(head)) return 'stop';
  return 'reply';
}
/** The reply itself, without the quoted original below it. */
export function firstLines(text: string): string {
  const cut = text.split(/\n(?:>|On .{5,80} wrote:|-{2,}\s*Original Message|From: )/i)[0];
  return cut.split('\n').slice(0, 30).join('\n').trim();
}

/** Free mail domains: matching a reply on these by domain alone would mix up businesses. */
export const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'btinternet.com', 'sky.com', 'proton.me', 'protonmail.com', 'pm.me', 'virginmedia.com', 'talktalk.net', 'msn.com']);
export const domainOf = (addr: string | null | undefined) => (addr?.toLowerCase().split('@')[1] ?? '').trim();
