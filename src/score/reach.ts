/**
 * How a lead can be pitched, worked out before anything is built, so a site never gets made for a
 * business there's no way to reach. UK rules (PECR) shape it: an unsolicited email or text needs consent
 * from a sole trader, so only limited companies can be emailed cold; everyone else gets a call or a visit
 * first, and the link follows once they've said yes.
 */
import type { Category } from '../config.js';
import type { FullLead } from '../db/types.js';
import { bestEmail, socialOf, type Social } from '../audit/contacts.js';

export type ReachLevel = 'email' | 'message' | 'call' | 'visit' | 'none';
export interface Reach {
  level: ReachLevel;            // the best way to get the preview to them
  email: string | null;         // added by you, on their own site, or found on the open web and checked
  emailAllowed: boolean;        // a limited company with an email: cold email is allowed
  mobile: boolean;              // a UK mobile: WhatsApp or text once they've agreed
  phone: string | null;         // E.164
  walkIn: boolean;              // a shop people walk into
  socials: Social[];
  summary: string;              // one plain sentence
}

const parse = <T,>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };

/** Pure: everything comes from the lead, its audit, Companies House and the category. */
export function reachOf(full: FullLead, category: Category | undefined): Reach {
  const { lead, audit, ch } = full;
  const a = audit as (typeof audit & { emails_json?: string | null; socials_json?: string | null }) | undefined;
  const emails = parse<string[]>(a?.emails_json, []);
  const socials = parse<Social[]>(a?.socials_json, []);
  const listed = lead.website_url ? socialOf(lead.website_url) : null;
  if (listed && !socials.some((s) => s.kind === listed.kind)) socials.unshift(listed);
  const email = lead.manual_email?.trim() || bestEmail(emails, a?.final_domain ?? null) || lead.web_email?.trim() || null;
  const ltd = ch?.match_confidence === 'high';
  const emailAllowed = !!email && ltd;
  const phone = lead.phone_e164;
  const mobile = !!phone && /^\+447\d{9}$/.test(phone);
  const walkIn = !!lead.address && !!category?.walk_in;
  const level: ReachLevel = emailAllowed ? 'email' : mobile || socials.length ? 'message' : phone ? 'call' : walkIn || lead.address ? 'visit' : 'none';
  const social = socials.map((s) => (s.kind === 'x' ? 'X' : s.kind.charAt(0).toUpperCase() + s.kind.slice(1)));
  const summary =
    level === 'email' ? `Email ${email} (limited company, so cold email is allowed).`
    : level === 'message' ? `${[mobile ? 'mobile, for WhatsApp after a call' : null, social.length ? `${social.join(' and ')} message` : null].filter(Boolean).join('; ')}.${email && !ltd ? ' Has an email, but not a limited company, so call first.' : ''}`.replace(/^./, (c) => c.toUpperCase())
    : level === 'call' ? (email ? `Landline, and ${email}, but not a limited company: call${walkIn ? ' or walk in' : ''} first, then email the link.` : `Landline only, no email or mobile: call${walkIn ? ' or walk in' : ''}, then ask where to send the link.`)
    : level === 'visit' ? (email ? `No phone, and ${email}, but not a limited company: visit first, then email the link.` : 'No phone, email or social: only a visit.')
    : 'No way to reach them found.';
  return { level, email, emailAllowed, mobile, phone, walkIn, socials, summary };
}

export const REACH_LABEL: Record<ReachLevel, string> = { email: 'Can email', message: 'Can message', call: 'Call only', visit: 'Visit only', none: 'No contact' };
