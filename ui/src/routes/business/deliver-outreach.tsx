import { ArrowDownLeft, ArrowUpRight, ChevronDown, Clock, Eye, MailCheck, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Delivery, FollowUp, OutreachMessage, OutreachStatus } from '../../../../src/ui/api-types';
import { ApiError, useCheckReplies, useFollowUp, useLeadOutreach, useOutreach, useRecheckDns, useSendPitch } from '../../api';
import { Button } from '../../components/ui/button';
import { Dot } from '../../components/ui/chip';
import { Confirm } from '../../components/ui/dialog';
import { Section } from '../../components/ui/section';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { CHANNEL_LABEL, clock, dateOnly, timeAgo } from '../../lib/format';
import { useCopy } from './deliver-copy';

/** One line on how sending works right now, with the reasons it isn't automatic and the DNS checks behind a toggle. */
export function SendingLine() {
  const o = useOutreach();
  const recheck = useRecheckDns();
  const [open, setOpen] = useState(false);
  if (!o.data) return null;
  const s = o.data;
  const dnsBad = s.dns?.some((c) => !c.ok);
  return (
    <div className="glass rounded-card px-4 py-3 text-sm">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Dot tone={s.sendsForReal && !s.problems.length ? 'ok' : s.transport === 'test' ? 'info' : 'muted'} />
        <span className="text-fg">{s.transportLabel}</span>
        {s.from ? <span className="text-fg-3">from {s.from}</span> : null}
        <span className="text-fg-3">· {s.cap.sentToday} of {s.cap.today} emails today (warm-up week {s.cap.warmupWeek})</span>
        {dnsBad ? <span className="text-warn">· domain setup incomplete</span> : null}
        <ChevronDown className={cn('ml-auto size-4 text-fg-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? <SendingDetail s={s} rechecking={recheck.isPending} onRecheck={() => recheck.mutate()} /> : null}
    </div>
  );
}

function SendingDetail({ s, rechecking, onRecheck }: { s: OutreachStatus; rechecking: boolean; onRecheck: () => void }) {
  const replies = useCheckReplies();
  const toast = useToast();
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border-soft pt-3">
      {s.problems.length ? <ul className="flex flex-col gap-1 text-fg-2">{s.problems.map((p) => <li key={p}>· {p}</li>)}</ul> : <p className="text-fg-2">Everything is set up. Acta can send email itself.</p>}
      {s.dns ? (
        <div>
          <p className="label mb-1.5">Sending domain</p>
          <ul className="flex flex-col gap-1">{s.dns.map((c) => <li key={c.name} className="flex gap-2"><Dot tone={c.ok ? 'ok' : 'bad'} className="mt-1.5" /><span><span className="text-fg">{c.name}</span> <span className="text-fg-3 break-all">{c.detail}</span></span></li>)}</ul>
        </div>
      ) : null}
      <p className="text-fg-3">Follow-ups on day {s.followUps.days.join(' and ')}, at most {s.followUps.maxContacts} contacts. {s.followUps.auto ? 'Due email follow-ups are sent automatically.' : 'Due follow-ups appear in your Inbox.'} {s.replies.check ? `Replies are checked automatically${s.replies.lastCheckedAt ? `, last ${timeAgo(s.replies.lastCheckedAt)}` : ''}.` : 'Reply detection is off.'}</p>
      {s.replies.lastError ? <p className="text-warn">{s.replies.lastError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={rechecking} onClick={onRecheck}><RefreshCw className="size-3.5" aria-hidden />Check the domain again</Button>
        {s.replies.check ? <Button size="sm" variant="ghost" loading={replies.isPending} onClick={() => replies.mutate(undefined, { onSuccess: (r) => toast({ kind: r.error ? 'error' : 'ok', text: r.error ?? `${r.checked} new messages, ${r.matched.length} from businesses` }) })}><MailCheck className="size-3.5" aria-hidden />Check for replies now</Button> : null}
      </div>
      <p className="text-xs text-fg-3">Settings live in config/outreach.yaml.</p>
    </div>
  );
}

/** "Send email" for the pitch, when Acta can send itself. Asks first, and asks again past today's warm-up limit. */
export function SendEmailButton({ d, onSent }: { d: Delivery; onSent: () => void }) {
  const o = useOutreach();
  const lo = useLeadOutreach(d.slug);
  const send = useSendPitch();
  const toast = useToast();
  const [ask, setAsk] = useState<'confirm' | 'cap' | null>(null);
  if (!o.data?.canSendNow || !d.emailAllowed) return null;
  const blockers = lo.data?.pitchBlockers ?? [];
  const go = (override = false) => send.mutate({ slug: d.slug, override }, {
    onSuccess: (r) => { setAsk(null); toast({ kind: 'ok', text: r.message }); onSent(); },
    onError: (e) => { if (e instanceof ApiError && e.code === 'cap' && !override) setAsk('cap'); else { setAsk(null); toast({ kind: 'error', text: e.message }); } },
  });
  return (
    <>
      <Button variant="primary" size="lg" disabled={blockers.length > 0} title={blockers[0]} onClick={() => setAsk('confirm')}><Send className="size-4" aria-hidden />{o.data.transport === 'test' ? 'Send (test)' : 'Send email'}</Button>
      {blockers.length ? <p className="text-xs text-fg-3">{blockers[0]}</p> : null}
      <Confirm open={ask === 'confirm'} onClose={() => setAsk(null)} onConfirm={() => go(false)} busy={send.isPending} confirmLabel={o.data.transport === 'test' ? 'Write the test email' : 'Send now'}
        title={`Send the pitch to ${d.to}?`}>
        <p>“{d.subject}” goes from {o.data.from}. {o.data.transport === 'test' ? 'Test mode: it is written to out/outbox, not sent.' : `${o.data.cap.left} of today's ${o.data.cap.today} warm-up emails are left.`} Follow-up reminders start once it's sent.</p>
      </Confirm>
      <Confirm open={ask === 'cap'} onClose={() => setAsk(null)} onConfirm={() => go(true)} busy={send.isPending} confirmLabel="Send anyway" title="Today's warm-up limit is used">
        A new domain that sends too much too soon lands in spam folders. Waiting until tomorrow is safer.
      </Confirm>
    </>
  );
}

/** One line: has a person opened the preview since the pitch? Separates "the offer didn't land" from "they never saw it". */
export function PreviewOpensLine({ slug }: { slug: string }) {
  const lo = useLeadOutreach(slug);
  if (!lo.data) return null;
  const { opens, opensTracked } = lo.data;
  if (!opensTracked) return <p className="text-xs text-fg-3">Preview opens aren't counted: add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to .env</p>;
  const n = opens?.opens ?? 0;
  return (
    <p className={cn('flex items-center gap-1.5 text-sm', n ? 'text-fg-2' : 'text-fg-3')}>
      <Eye className="size-3.5 shrink-0" aria-hidden />
      {n ? `Preview opened ${n === 1 ? 'once' : `${n} times`}${opens?.lastAt ? `, last ${timeAgo(opens.lastAt)}` : ''}` : 'Not opened yet'}
    </p>
  );
}

/** The next follow-up: when it's due, the message ready to edit, and send or record it. */
export function FollowUpPanel({ slug }: { slug: string }) {
  const lo = useLeadOutreach(slug);
  const o = useOutreach();
  const act = useFollowUp();
  const toast = useToast();
  const f = lo.data?.followUp;
  const [body, setBody] = useState('');
  useEffect(() => { if (f) setBody(f.body); }, [f?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const { copy, copied } = useCopy();
  if (!f) return null;
  const canSend = f.canEmail && !!o.data?.canSendNow;
  const run = (mode: 'send' | 'logged', override = false) => act.mutate({ slug, mode, subject: f.subject, body, channel: f.channel, override }, {
    onSuccess: (r) => toast({ kind: 'ok', text: r.message }),
    onError: (e) => { if (e instanceof ApiError && e.code === 'cap' && !override) toast({ kind: 'error', text: `${e.message} Send it tomorrow, or record it if you send it yourself.` }); else toast({ kind: 'error', text: e.message }); },
  });
  return (
    <Section title={<h2 className="flex items-center gap-2 text-sm font-medium"><Clock className="size-4 text-fg-3" aria-hidden />{f.last ? 'Last follow-up' : `Follow-up ${f.n}`}</h2>}
      actions={<span className={cn('text-xs', f.overdue ? 'text-warn' : 'text-fg-3')}>{f.overdue ? `Due ${dateOnly(f.dueAt)}` : `Due ${dateOnly(f.dueAt)}`}</span>} bodyClassName="flex flex-col gap-3 p-5">
      <FollowUpBody f={f} body={body} setBody={setBody} />
      <div className="flex flex-wrap items-center gap-2">
        {canSend ? <Button variant="primary" loading={act.isPending && act.variables?.mode === 'send'} onClick={() => run('send')}><Send className="size-4" aria-hidden />Send follow-up</Button> : null}
        <Button variant="secondary" onClick={() => void copy(body)}>{copied ? 'Copied' : 'Copy message'}</Button>
        <Button variant={canSend ? 'ghost' : 'primary'} loading={act.isPending && act.variables?.mode === 'logged'} onClick={() => run('logged')}>I sent it myself</Button>
      </div>
      {!f.canEmail && f.channel === 'email' ? <p className="text-xs text-fg-3">Acta can't email this business itself, so send it from your mail app.</p> : null}
      {f.channel !== 'email' ? <p className="text-xs text-fg-3">The first contact was by {CHANNEL_LABEL[f.channel] ?? f.channel}, so follow up the same way: a call, a visit or a message.</p> : null}
    </Section>
  );
}
function FollowUpBody({ f, body, setBody }: { f: FollowUp; body: string; setBody: (s: string) => void }) {
  return (
    <>
      {f.channel === 'email' ? <p className="text-sm text-fg-3">To {f.to ?? 'their email'} · “{f.subject}”</p> : null}
      <label className="sr-only" htmlFor="fu-body">Follow-up message</label>
      <textarea id="fu-body" className="field min-h-44 font-[inherit]" value={body} onChange={(e) => setBody(e.target.value)} />
    </>
  );
}

/** Every message to and from this business, newest first. */
export function MessageHistory({ slug }: { slug: string }) {
  const lo = useLeadOutreach(slug);
  const list = lo.data?.messages ?? [];
  if (!list.length) return null;
  return (
    <Section title="Messages">
      <ul className="divide-y divide-border-soft">{list.map((m) => <MessageRow key={m.id} m={m} />)}</ul>
    </Section>
  );
}
const KIND_LABEL: Record<OutreachMessage['kind'], string> = { pitch: 'Pitch', followup_1: 'Follow-up 1', followup_2: 'Follow-up 2', reply: 'Their reply' };
const STATUS_LABEL: Record<OutreachMessage['status'], string> = { sent: 'sent by Acta', logged: 'sent by you', written: 'test, not sent', failed: 'failed', received: 'received' };
function MessageRow({ m }: { m: OutreachMessage }) {
  const [open, setOpen] = useState(m.direction === 'in');
  const Icon = m.direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  return (
    <li className="px-5 py-3">
      <button type="button" className="flex w-full items-start gap-3 text-left" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Icon className={cn('mt-0.5 size-4 shrink-0', m.direction === 'in' ? 'text-ok' : 'text-fg-3', m.status === 'failed' && 'text-bad')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg">{KIND_LABEL[m.kind]} <span className="text-fg-3">· {CHANNEL_LABEL[m.channel] ?? m.channel}, {STATUS_LABEL[m.status]}</span></span>
          {m.subject ? <span className="block truncate text-xs text-fg-3">{m.subject}</span> : null}
          {m.error ? <span className="block text-xs text-bad">{m.error}</span> : null}
        </span>
        <span className="shrink-0 text-xs text-fg-3">{clock(m.at)}</span>
      </button>
      {open && m.body ? <pre className="mt-2 ml-7 max-h-64 overflow-auto rounded-card bg-white/[0.04] p-3 font-[inherit] text-sm whitespace-pre-wrap text-fg-2">{m.body}</pre> : null}
    </li>
  );
}
