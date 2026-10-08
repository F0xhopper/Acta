/**
 * Reply detection: read new mail in the inbox through Proton Mail Bridge, match each message to a business
 * we've pitched, and act on it. A reply moves the business to Replied, which stops its follow-ups. A reply
 * asking to stop puts it on the do-not-contact list. Out-of-office and bounce messages are recorded only.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { openDb } from '../db/index.js';
import { setStatus } from '../db/queries.js';
import { applyStatus } from '../crm/status.js';
import { readDelivery } from '../delivery/index.js';
import { loadOutreach, secrets } from './config.js';
import { classifyReply, domainOf, firstLines, FREE_MAIL, type ReplyKind } from './rules.js';
import { byMessageId, getState, recordMessage, seenInbound, setNextTouch, setState } from './store.js';

interface Candidate { lead_id: number; slug: string; name: string; to: string | null; site: string | null }

/** Businesses we're waiting to hear from, with the addresses and domains a reply could come from. */
function candidates(): Candidate[] {
  const rows = openDb().prepare(`SELECT l.id lead_id, l.slug, l.name, a.final_domain site FROM leads l JOIN pipeline p ON p.lead_id = l.id LEFT JOIN audits a ON a.lead_id = l.id
    WHERE p.status IN ('contacted','followup_1','followup_2')`).all() as unknown as Omit<Candidate, 'to'>[];
  return rows.map((r) => ({ ...r, to: readDelivery(r.slug)?.to ?? null }));
}

/** Which business a message is from: by thread first, then exact address, then the business's own domain. Pure apart from the thread lookup. */
export function matchSender(from: string, threadIds: string[], list: Candidate[]): Candidate | null {
  const thread = byMessageId(threadIds);
  if (thread) return list.find((c) => c.lead_id === thread.lead_id) ?? null;
  const addr = from.toLowerCase();
  const exact = list.find((c) => c.to && c.to.toLowerCase() === addr);
  if (exact) return exact;
  const dom = domainOf(addr);
  if (!dom || FREE_MAIL.has(dom)) return null;
  return list.find((c) => (c.to && domainOf(c.to) === dom) || (c.site && c.site.replace(/^www\./, '') === dom)) ?? null;
}

export interface ReplyResult { checked: number; matched: { slug: string; name: string; kind: ReplyKind }[]; error: string | null }

export async function checkReplies(): Promise<ReplyResult> {
  const cfg = loadOutreach();
  const s = secrets();
  const result: ReplyResult = { checked: 0, matched: [], error: null };
  if (!s.bridgeUser || !s.bridgePassword) { result.error = 'Add PROTON_BRIDGE_USER and PROTON_BRIDGE_PASSWORD (from the Bridge app) to .env to detect replies.'; setState('replies_error', result.error); return result; }
  const local = /^(127\.0\.0\.1|localhost|::1)$/.test(cfg.proton_bridge.host);
  const client = new ImapFlow({
    host: cfg.proton_bridge.host, port: cfg.proton_bridge.imap_port, secure: false, doSTARTTLS: true,
    auth: { user: s.bridgeUser, pass: s.bridgePassword }, logger: false,
    tls: { rejectUnauthorized: !local }, // Bridge's self-signed certificate, trusted only on this Mac
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mbox = client.mailbox as { uidValidity: bigint; uidNext: number };
      const validity = String(mbox.uidValidity);
      let lastUid = Number(getState('imap_last_uid') ?? 0);
      if (getState('imap_uid_validity') !== validity) { lastUid = 0; setState('imap_uid_validity', validity); }
      // First run: look back over the last 30 days only, not the whole mailbox.
      const range = lastUid > 0 ? `${lastUid + 1}:*` : null;
      const uids: number[] = range
        ? ((await client.search({ uid: range }, { uid: true })) || []).filter((u) => u > lastUid)
        : (await client.search({ since: new Date(Date.now() - 30 * 86_400_000) }, { uid: true })) || [];
      const list = candidates();
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;
        result.checked++;
        lastUid = Math.max(lastUid, uid);
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value[0]?.address ?? '';
        const messageId = parsed.messageId ?? `uid-${validity}-${uid}`;
        if (!from || seenInbound(messageId) || from.toLowerCase() === cfg.fromAddress.toLowerCase()) continue;
        const refs = [parsed.inReplyTo ?? '', ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])];
        const who = matchSender(from, refs, list);
        if (!who) continue;
        const text = parsed.text ?? '';
        const kind = classifyReply(parsed.subject ?? '', text);
        recordMessage({ lead_id: who.lead_id, slug: who.slug, direction: 'in', kind: 'reply', channel: 'email', to_addr: cfg.fromAddress, from_addr: from,
          subject: parsed.subject ?? null, body: firstLines(text).slice(0, 4000), transport: 'imap', status: 'received', message_id: messageId, in_reply_to: parsed.inReplyTo ?? null, provider_id: String(uid), error: null });
        if (kind === 'stop') { applyStatus(who.slug, 'do_not_contact', 'asked to stop, by email reply'); setNextTouch(who.lead_id, null); }
        else if (kind === 'reply') { setStatus(who.slug, 'replied', 'replied by email'); setNextTouch(who.lead_id, null); }
        result.matched.push({ slug: who.slug, name: who.name, kind });
      }
      setState('imap_last_uid', String(Math.max(lastUid, (mbox.uidNext ?? 1) - 1)));
    } finally { lock.release(); }
    await client.logout();
    setState('replies_error', '');
  } catch (e) {
    result.error = `Couldn't read the inbox through Proton Mail Bridge: ${(e as Error).message}. Is Bridge open?`;
    setState('replies_error', result.error);
    try { client.close(); } catch { /* already closed */ }
  }
  setState('replies_checked_at', new Date().toISOString());
  setState('replies_matched', String(Number(getState('replies_matched') ?? 0) + result.matched.length));
  return result;
}
