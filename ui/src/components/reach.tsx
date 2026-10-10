import { useQueryClient } from '@tanstack/react-query';
import { AtSign, ExternalLink, Globe, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { LeadSummary, Reach, ReachLevel } from '../../../src/ui/api-types';
import { useJob, useSetContact, useWebEmail } from '../api';
import { timeAgo } from '../lib/format';
import { Button } from './ui/button';
import { Dot, type DotTone } from './ui/chip';
import { Confirm } from './ui/dialog';
import { useToast } from './ui/toast';

export const REACH_TONE: Record<ReachLevel, DotTone> = { email: 'ok', message: 'info', call: 'warn', visit: 'warn', none: 'bad' };
export const REACH_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any reach' }, { value: 'email', label: 'Can email' }, { value: 'email,message', label: 'Can email or message' },
  { value: 'call,visit,none', label: 'Call or visit only' },
];
export type EmailState = 'cold' | 'call_first' | 'none' | 'unchecked';
/** Whether there's an email to send to: cold email allowed (limited company), an email but call first, none found, or their site not read yet. */
export function emailState(reach: Reach, websiteStatus: string | null): EmailState {
  if (reach.email) return reach.emailAllowed ? 'cold' : 'call_first';
  return websiteStatus === 'live' && !reach.checkedAt ? 'unchecked' : 'none';
}
const EMAIL_TONE: Record<EmailState, DotTone> = { cold: 'ok', call_first: 'info', none: 'muted', unchecked: 'muted' };
const EMAIL_LABEL: Record<EmailState, string> = { cold: 'Can cold email', call_first: 'Has email', none: 'None found', unchecked: 'Not checked' };
export const EMAIL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any email' }, { value: 'has', label: 'Has an email' }, { value: 'cold', label: 'Can cold email' }, { value: 'none', label: 'No email' },
];

const SOURCE_LABEL: Record<NonNullable<Reach['emailSource']>, string> = { you: 'added by you', site: 'from their site', web: 'found on the web' };

/** The email, if there is one: a dot and words, the address and the rule on hover. */
export function EmailChip({ reach, websiteStatus }: { reach: Reach; websiteStatus: string | null }) {
  const st = emailState(reach, websiteStatus);
  const title = reach.email
    ? `${reach.email} (${SOURCE_LABEL[reach.emailSource ?? 'site']}). ${reach.emailAllowed ? 'A limited company: cold email is allowed.' : 'Not a limited company: call or visit first, then email the link.'}`
    : st === 'unchecked' ? 'Their website has not been read for an email yet.' : websiteStatus === 'live' ? 'No email on their website.' : 'No website to find an email on. Add one on the Overview tab if you find it.';
  return <span title={title} className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2"><Dot tone={EMAIL_TONE[st]} />{EMAIL_LABEL[st]}</span>;
}

/** How the preview gets to them, in one line for a table: the route, and the address underneath when there is one. */
export function ReachLine({ reach }: { reach: Reach }) {
  const [tone, text]: [DotTone, string] = reach.emailAllowed ? ['ok', 'Cold email']
    : reach.email ? ['info', 'Email, call first']
    : reach.level === 'message' ? ['info', reach.mobile ? 'Mobile, no email' : 'Social, no email']
    : reach.level === 'call' ? ['warn', 'Landline only']
    : reach.level === 'visit' ? ['warn', 'Visit only'] : ['bad', 'No contact'];
  return (
    <div className="min-w-0" title={reach.summary}>
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2"><Dot tone={tone} />{text}</span>
      {reach.email ? <div className="truncate text-xs text-fg-3">{reach.email}</div> : null}
    </div>
  );
}

/** Leads where you'd have nowhere to send the link without calling or visiting first. */
export const hardToReach = (r: Reach) => r.level === 'call' || r.level === 'visit' || r.level === 'none';

/** How to reach them, as a small chip: a coloured dot and words, with the full sentence on hover. */
export function ReachChip({ reach, className }: { reach: Reach; className?: string }) {
  return (
    <span title={reach.summary} className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2 ${className ?? ''}`}>
      <Dot tone={REACH_TONE[reach.level]} />{reach.label}
    </span>
  );
}

/** The routes in, as a list: email, mobile, socials, phone, walk-in. */
export function ReachRoutes({ reach, phone }: { reach: Reach; phone: string | null }) {
  const rows: { icon: ReactNode; text: ReactNode }[] = [];
  if (reach.email) rows.push({ icon: <AtSign className="size-3.5" aria-hidden />, text: <>{reach.email} <span className="text-fg-3">· {reach.emailUrl ? <a href={reach.emailUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{SOURCE_LABEL.web}</a> : SOURCE_LABEL[reach.emailSource ?? 'site']}{reach.emailAllowed ? '' : ', not a limited company, so call first'}</span></> });
  if (phone) rows.push({ icon: <Phone className="size-3.5" aria-hidden />, text: <>{phone} <span className="text-fg-3">· {reach.mobile ? 'mobile, WhatsApp the link after a call' : 'landline, call and ask where to send the link'}</span></> });
  for (const s of reach.socials) rows.push({ icon: <MessageCircle className="size-3.5" aria-hidden />, text: <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{s.kind.charAt(0).toUpperCase() + s.kind.slice(1)}</a> });
  if (reach.walkIn) rows.push({ icon: <MapPin className="size-3.5" aria-hidden />, text: 'A shop you can walk into' });
  if (!rows.length) return <p className="text-sm text-fg-3">No contact details found.</p>;
  return <ul className="flex flex-col gap-1.5 text-sm text-fg-2">{rows.map((r, i) => <li key={i} className="flex items-start gap-2"><span className="mt-1 text-fg-3">{r.icon}</span><span className="min-w-0 break-words">{r.text}</span></li>)}</ul>;
}

/** The town in a UK address: the last part, without the postcode. Pure. */
export function townOf(address: string | null, fallback: string): string {
  const last = address?.split(',').pop()?.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').trim();
  return last || fallback;
}

/** Where to look by eye for an email the pipeline can't read: Facebook and Instagram forbid scraping, so these are links for you. */
export function lookupLinks(lead: { name: string; address: string | null; area: string }): { label: string; url: string }[] {
  const town = townOf(lead.address, lead.area);
  const q = encodeURIComponent;
  return [
    { label: 'Facebook', url: `https://www.facebook.com/search/pages/?q=${q(`${lead.name} ${town}`)}` },
    { label: 'Instagram', url: `https://www.google.com/search?q=${q(`site:instagram.com "${lead.name}" ${town}`)}` },
    { label: 'Google', url: `https://www.google.com/search?q=${q(`"${lead.name}" ${town} email`)}` },
  ];
}

/** No email yet: search the open web for one, or look on their socials by eye. */
export function EmailLookup({ slug, lead, reach }: { slug: string; lead: { name: string; address: string | null; area: string }; reach: Reach }) {
  const start = useWebEmail();
  const toast = useToast();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<number | undefined>();
  const job = useJob(jobId);
  const running = start.isPending || job.data?.status === 'queued' || job.data?.status === 'running';
  useEffect(() => {
    if (!job.data || running) return;
    void qc.invalidateQueries();
    toast(job.data.status === 'done' ? { kind: 'ok', text: 'Web search finished' } : { kind: 'error', text: 'The web search failed. See Jobs for the log.' });
    setJobId(undefined);
  }, [job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (reach.email) return null;
  const go = () => start.mutate(slug, { onSuccess: (j) => setJobId(j.id), onError: (e) => toast({ kind: 'error', text: e.message }) });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={running} onClick={go} title="A short Claude run that searches booking sites, directories and news, then checks the page it found"><Globe className="size-3.5" aria-hidden />{running ? 'Searching the web' : 'Search the web for an email'}</Button>
        <span className="text-xs text-fg-3">{reach.webSearchedAt ? `Last searched ${timeAgo(reach.webSearchedAt)}, nothing confirmed.` : 'Not searched yet.'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
        <span>Look by eye:</span>
        {lookupLinks(lead).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-fg">{l.label}<ExternalLink className="size-3" aria-hidden /></a>)}
      </div>
    </div>
  );
}

/** Add, change or clear an email you found yourself. */
export function EmailEditor({ slug, reach }: { slug: string; reach: Reach }) {
  const set = useSetContact();
  const toast = useToast();
  const [value, setValue] = useState(reach.emailSource === 'you' ? reach.email ?? '' : '');
  const save = (email: string | null) => set.mutate({ slug, email }, {
    onSuccess: (r) => toast({ kind: 'ok', text: r.message }),
    onError: (e) => toast({ kind: 'error', text: e.message }),
  });
  return (
    <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); save(value.trim() || null); }}>
      <label htmlFor={`email-${slug}`} className="label">{reach.emailSource === 'you' ? 'Their email (added by you)' : 'Found their email somewhere? Add it'}</label>
      <div className="flex gap-2">
        <input id={`email-${slug}`} type="email" className="field flex-1" placeholder="e.g. owner@gmail.com, from their Facebook page" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" variant="secondary" loading={set.isPending} disabled={!value.trim() && reach.emailSource !== 'you'}>{value.trim() ? 'Save' : 'Clear'}</Button>
      </div>
    </form>
  );
}

/** Ask before building a site for a business you can only call or visit. Returns a gate and the dialog to render. */
export function useReachGate() {
  const [pending, setPending] = useState<{ leads: Pick<LeadSummary, 'name' | 'reach'>[]; go: () => void } | null>(null);
  const gate = (leads: Pick<LeadSummary, 'name' | 'reach'>[], go: () => void) => {
    const hard = leads.filter((l) => hardToReach(l.reach));
    if (!hard.length) { go(); return; }
    setPending({ leads: hard, go });
  };
  const dialog = (
    <Confirm open={!!pending} onClose={() => setPending(null)} confirmLabel="Build anyway" onConfirm={() => { const g = pending?.go; setPending(null); g?.(); }}
      title={pending && pending.leads.length === 1 ? `${pending.leads[0].name} has nowhere to send the link` : `${pending?.leads.length ?? 0} of these have nowhere to send the link`}>
      <p>{pending?.leads.length === 1 ? pending.leads[0].reach.summary : 'No email or mobile was found for them, so you can only call or visit.'} You'd need to get an email or mobile from them before you can send the preview. Add one first if you have it.</p>
      {pending && pending.leads.length > 1 ? <ul className="mt-2 list-disc pl-5 text-fg-3">{pending.leads.slice(0, 6).map((l) => <li key={l.name}>{l.name}: {l.reach.label}</li>)}</ul> : null}
    </Confirm>
  );
  return { gate, dialog };
}
