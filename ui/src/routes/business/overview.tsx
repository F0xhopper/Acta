import { ArrowRight, Clock, Phone, PhoneCall, Quote, Star } from 'lucide-react';
import { useState } from 'react';
import type { LeadDetail, TimelineEntry } from '../../../../src/ui/api-types';
import { useCallOutcome, usePick, useSetStatus, useStartBuild, useTeardown } from '../../api';
import { useAgentGuard } from '../../components/agent-guard';
import { Button, ButtonA, ButtonLink } from '../../components/ui/button';
import { Chip, Dot } from '../../components/ui/chip';
import { Confirm } from '../../components/ui/dialog';
import { Section } from '../../components/ui/section';
import { ContentChip, ContentList } from '../../components/content';
import { QualifyPanel, VerdictChip } from '../../components/qualify';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { CHANNEL_LABEL, SITE_STATUS_LABEL, clock, timeAgo } from '../../lib/format';
import { useBusiness } from './context';
import { EmailEditor, EmailLookup, ReachChip, ReachRoutes, useReachGate, EmailChip } from '../../components/reach';
import { bizPath } from '../../lib/links';

/** The three reviews worth quoting: highest rated, then the most said. */
export function bestReviews(list: LeadDetail['reviewsList'], n = 3) {
  return [...list].filter((r) => r.text.trim().length > 20).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.text.length - a.text.length).slice(0, n);
}

function NextAction() {
  const { slug, lead } = useBusiness();
  const guard = useAgentGuard();
  const start = useStartBuild();
  const toast = useToast();
  const reachGate = useReachGate();
  const a = lead.nextAction;
  if (!a) return null;
  if (a.kind === 'build') {
    const run = () => void guard(`Building ${lead.name}`, (override) => start.mutateAsync({ slug, override }))
      .then((job) => { if (job) toast({ kind: 'ok', text: `Build queued for ${lead.name}`, link: { to: bizPath(slug, 'progress'), label: 'Watch progress' } }); });
    const go = () => reachGate.gate([lead], run);
    return <><Button size="lg" variant="primary" loading={start.isPending} onClick={go}>{a.label}<ArrowRight className="size-4" aria-hidden /></Button>{reachGate.dialog}</>;
  }
  if (a.kind === 'wait') return <ButtonLink size="lg" variant="secondary" to={bizPath(slug, a.tab)}><Dot tone="live" />{a.label}</ButtonLink>;
  if (a.kind === 'call') return <ButtonA size="lg" variant="primary" href="#call-first" target="_self" rel={undefined}><PhoneCall className="size-4" aria-hidden />{a.label}</ButtonA>;
  return <ButtonLink size="lg" variant="primary" to={bizPath(slug, a.tab)}>{a.label}<ArrowRight className="size-4" aria-hidden /></ButtonLink>;
}

/** The call before the build: the script, then one tap to record yes or no. No asks first, because it marks them lost. */
function CallFirst() {
  const { slug, lead } = useBusiness();
  const call = useCallOutcome();
  const toast = useToast();
  const [askNo, setAskNo] = useState(false);
  const [note, setNote] = useState('');
  const c = lead.callFirst;
  if (!c) return null;
  const answer = (a: 'yes' | 'no') => void call.mutateAsync({ slug, answer: a, note: note.trim() || undefined })
    .then((r) => { setAskNo(false); toast({ kind: r.ok ? 'ok' : 'error', text: r.message }); })
    .catch((e: Error) => toast({ kind: 'error', text: e.message }));
  return (
    <Section title={<h2 id="call-first" className="text-sm font-medium">Call first</h2>} actions={c.consent
      ? <Chip dot={c.consent.answer === 'yes' ? 'ok' : 'muted'}>{c.consent.answer === 'yes' ? 'They said yes' : 'They said no'} · {timeAgo(c.consent.at)}</Chip>
      : c.waiting ? <Chip dot="warn">Build waits for this</Chip> : null} bodyClassName="flex flex-col gap-4 px-5 py-4">
      <p className="text-sm text-fg-3">{c.waiting ? 'Thirty seconds on the phone before anything is built. Yes turns the build into one they asked to see; no saves it.' : 'Cold email isn\'t allowed here, so the first contact is a call either way.'}</p>
      <div className="flex flex-col gap-2 text-sm text-fg">{c.lines.filter(Boolean).map((l, i) => <p key={i} className={cn(l.startsWith('"') && 'rounded-card border border-border-soft bg-panel px-3.5 py-3 text-fg')}>{l}</p>)}</div>
      {c.consent?.note ? <p className="text-sm text-fg-3">Note: {c.consent.note}</p> : null}
      {!c.consent ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input className="field flex-1" placeholder="What they said (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note from the call" />
          <div className="flex gap-2">
            <Button variant="primary" loading={call.isPending} onClick={() => answer('yes')}>They said yes</Button>
            <Button variant="secondary" onClick={() => setAskNo(true)}>They said no</Button>
          </div>
          <Confirm open={askNo} onClose={() => setAskNo(false)} onConfirm={() => answer('no')} busy={call.isPending} title={`${lead.name} said no?`} confirmLabel="Mark as no">
            Nothing gets built, the pick is dropped, and they go on the do-not-contact list.
          </Confirm>
        </div>
      ) : null}
    </Section>
  );
}

type Outcome = 'replied' | 'followup_1' | 'followup_2' | 'won' | 'lost';
/** After the pitch: one click to record what happened. Lost asks first, because it adds them to the do-not-contact list. */
export function outcomesFor(status: string): Outcome[] {
  if (status === 'contacted') return ['replied', 'followup_1', 'won', 'lost'];
  if (status === 'followup_1') return ['replied', 'followup_2', 'won', 'lost'];
  if (status === 'followup_2') return ['replied', 'won', 'lost'];
  if (status === 'replied') return ['won', 'lost'];
  return [];
}
const OUTCOME_LABEL: Record<Outcome, string> = { replied: 'They replied', followup_1: 'I followed up', followup_2: 'I followed up again', won: 'Won', lost: 'Lost' };

function Outcomes() {
  const { slug, lead } = useBusiness();
  const setStatus = useSetStatus();
  const toast = useToast();
  const [askLost, setAskLost] = useState(false);
  const list = outcomesFor(lead.status);
  if (!list.length) return null;
  const prev = lead.status;
  const go = (o: Outcome) => setStatus.mutate({ slug, status: o, note: 'logged from the UI' }, {
    onSuccess: (r) => { setAskLost(false); toast({ kind: r.ok ? 'ok' : 'error', text: r.ok ? `${lead.name}: ${OUTCOME_LABEL[o].toLowerCase()}` : r.message, action: r.ok && o !== 'lost' ? { label: 'Undo', onClick: () => setStatus.mutate({ slug, status: prev }) } : undefined }); },
    onError: (e) => toast({ kind: 'error', text: e.message }),
  });
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {list.map((o) => (
          <Button key={o} size="md" variant={o === 'won' ? 'primary' : o === 'lost' ? 'ghost' : 'secondary'} loading={setStatus.isPending && setStatus.variables?.status === o}
            onClick={() => (o === 'lost' ? setAskLost(true) : go(o))}>{OUTCOME_LABEL[o]}</Button>
        ))}
      </div>
      <Confirm open={askLost} onClose={() => setAskLost(false)} onConfirm={() => go('lost')} busy={setStatus.isPending} title={`Mark ${lead.name} as lost?`} confirmLabel="Mark as lost">
        They're added to the do-not-contact list, so they won't be pitched again.
      </Confirm>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4"><dt className="w-32 shrink-0 text-xs text-fg-3 sm:pt-0.5">{label}</dt><dd className="min-w-0 text-sm text-fg-2">{children}</dd></div>;
}

const TL_TONE: Record<TimelineEntry['kind'], 'info' | 'ok' | 'warn' | 'muted'> = { status: 'info', build: 'muted', job: 'muted', review: 'warn', note: 'muted' };

function DangerZone() {
  const { slug, lead, build } = useBusiness();
  const teardown = useTeardown();
  const setStatus = useSetStatus();
  const pick = usePick();
  const toast = useToast();
  const [ask, setAsk] = useState<'teardown' | 'dnc' | null>(null);
  const canTear = !!build && !['torn_down', 'live'].includes(build.state);
  const canDnc = lead.status !== 'do_not_contact';
  const canPick = lead.status === 'new';
  const canUnpick = lead.status === 'shortlisted' && (!build || build.state === 'picked');
  const fail = (e: Error) => toast({ kind: 'error', text: e.message });
  return (
    <Section title="Other actions" bodyClassName="flex flex-col divide-y divide-border-soft">
      {canPick || canUnpick ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm text-fg-2">{canPick ? 'Add this business to the build queue.' : 'Take this business out of the build queue.'}</p>
          <Button size="sm" variant="secondary" loading={pick.isPending}
            onClick={() => pick.mutate({ slug, pick: canPick }, { onSuccess: (r) => toast({ kind: r.ok ? 'ok' : 'error', text: r.message, action: r.ok ? { label: 'Undo', onClick: () => pick.mutate({ slug, pick: !canPick }) } : undefined }), onError: fail })}>
            {canPick ? 'Pick' : 'Unpick'}
          </Button>
        </div>
      ) : null}
      {canTear ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm text-fg-2">Tear down the preview. Removes the Vercel project and archives the repo.</p>
          <Button size="sm" variant="outline" onClick={() => setAsk('teardown')}>Tear down</Button>
        </div>
      ) : null}
      {canDnc ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm text-fg-2">Never contact this business.</p>
          <Button size="sm" variant="outline" onClick={() => setAsk('dnc')}>Do not contact</Button>
        </div>
      ) : <p className="px-5 py-3 text-sm text-fg-3">This business is on the do-not-contact list.</p>}
      <Confirm open={ask === 'teardown'} onClose={() => setAsk(null)} busy={teardown.isPending} title={`Tear down ${lead.name}?`} confirmLabel="Tear down"
        onConfirm={() => teardown.mutate(slug, { onSuccess: () => { setAsk(null); toast({ kind: 'ok', text: 'Tearing down the preview', link: { to: '/activity', label: 'See activity' } }); }, onError: fail })}>
        The preview link stops working and the repo is archived. This can't be undone from here.
      </Confirm>
      <Confirm open={ask === 'dnc'} onClose={() => setAsk(null)} busy={setStatus.isPending} title={`Never contact ${lead.name}?`} confirmLabel="Do not contact"
        onConfirm={() => setStatus.mutate({ slug, status: 'do_not_contact', note: 'marked do not contact from the UI' }, { onSuccess: (r) => { setAsk(null); toast({ kind: r.ok ? 'ok' : 'error', text: r.message }); }, onError: fail })}>
        Their phone, website and Google listing go on the suppression list, so no future search or pitch reaches them.
      </Confirm>
    </Section>
  );
}

export function OverviewTab() {
  const { slug, lead } = useBusiness();
  const reviews = bestReviews(lead.reviewsList);
  const a = lead.audit;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="glass-lit flex flex-col gap-4 rounded-panel p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-fg-3">Next</p>
            <p className="mt-1 text-lg font-light text-fg">{outcomesFor(lead.status).length ? 'What happened after the pitch?' : lead.nextAction ? lead.nextAction.label : 'Nothing to do right now.'}</p>
          </div>
          {outcomesFor(lead.status).length ? <Outcomes /> : <NextAction />}
        </div>

        <CallFirst />

        {lead.qualify ? <Section title="Gates" actions={<VerdictChip verdict={lead.qualify.verdict} grade={lead.qualify.grade} missing={lead.missing} />} bodyClassName="px-5 py-4">
          <QualifyPanel qualify={lead.qualify} />
        </Section> : null}

        <Section title="How to reach them" actions={<ReachChip reach={lead.reach} />} bodyClassName="flex flex-col gap-4 px-5 py-4">
          <p className="text-sm text-fg">{lead.reach.summary}</p>
          <ReachRoutes reach={lead.reach} phone={lead.phone} />
          <EmailLookup slug={slug} lead={lead} reach={lead.reach} />
          <EmailEditor slug={slug} reach={lead.reach} />
        </Section>

        <Section title="What we have to build from" actions={<ContentChip content={lead.content} long />} bodyClassName="px-5 py-3">
          <ContentList items={lead.contentItems} makeUp={lead.makeUp} />
        </Section>

        <Section title="Why it scored">
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="flex items-end gap-6">
              <div><p className="text-xs text-fg-3">Score</p><p className="num-display mt-1 text-[40px]">{lead.score ?? '—'}</p></div>
              <div className="pb-1 text-sm text-fg-3">Opportunity {lead.opportunity ?? '—'} · Viability {lead.viability ?? '—'} · Content {lead.content.score}</div>
            </div>
            {lead.hook ? <p className="text-sm text-fg">{lead.hook}</p> : null}
            {lead.reasons.length ? <ul className="flex flex-col gap-1.5">{lead.reasons.map((r) => <li key={r} className="flex gap-2 text-sm text-fg-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-fg-3" />{r}</li>)}</ul> : null}
            {lead.description.text ? <p className="text-sm text-fg-3">{lead.description.text}</p> : null}
          </div>
        </Section>

        {reviews.length ? (
          <Section title="What customers say">
            <ul className="grid gap-px sm:grid-cols-3">
              {reviews.map((r, i) => (
                <li key={i} className="flex flex-col gap-2 px-5 py-4">
                  <Quote className="size-4 text-fg-4" aria-hidden />
                  <p className="line-clamp-6 text-sm text-fg-2">{r.text}</p>
                  <p className="mt-auto text-xs text-fg-3">{r.rating !== null ? `${r.rating}★ · ` : ''}{r.author ?? 'A customer'}{r.when ? ` · ${r.when}` : ''}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Timeline">
          {lead.timeline.length ? (
            <ol className="flex flex-col px-5 py-3">
              {lead.timeline.slice(0, 40).map((t, i) => (
                <li key={i} className="flex gap-3 py-1.5">
                  <span className="pt-1.5"><Dot tone={t.level === 'error' ? 'bad' : t.level === 'warn' ? 'warn' : TL_TONE[t.kind]} /></span>
                  <span className={cn('min-w-0 flex-1 text-sm text-fg-2', t.level === 'error' && 'text-bad')}>{t.text}</span>
                  <time dateTime={t.at} title={clock(t.at)} className="shrink-0 text-xs text-fg-3">{timeAgo(t.at)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="px-5 py-4 text-sm text-fg-3">Nothing has happened with this business yet.</p>}
        </Section>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Section title="Facts">
          <dl className="divide-y divide-border-soft px-5 py-1">
            <Fact label="Phone">{lead.phone ? <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 text-fg hover:underline"><Phone className="size-3.5" aria-hidden />{lead.phone}</a> : 'None listed'}</Fact>
            <Fact label="Address">{lead.address ?? '—'}</Fact>
            <Fact label="Rating">{lead.rating !== null ? <span className="inline-flex items-center gap-1"><Star className="size-3.5" aria-hidden />{lead.rating.toFixed(1)} from {lead.reviews} reviews</span> : `${lead.reviews} reviews`}</Fact>
            <Fact label="Email">{lead.reach.email ? <><a href={`mailto:${lead.reach.email}`} className="text-fg hover:underline">{lead.reach.email}</a><span className="text-fg-3"> · {lead.reach.emailAllowed ? 'cold email allowed' : 'call first'}</span></> : <EmailChip reach={lead.reach} websiteStatus={lead.websiteStatus} />}</Fact>
            <Fact label="Business">{lead.ltd ? 'Limited company' : 'Sole trader or partnership'}</Fact>
            <Fact label="Channel">{lead.channel ? CHANNEL_LABEL[lead.channel] ?? lead.channel : '—'}{!lead.ltd ? <span className="text-fg-3"> · no cold email</span> : null}</Fact>
            <Fact label="Website">
              {lead.websiteStatus ? SITE_STATUS_LABEL[lead.websiteStatus] ?? lead.websiteStatus : '—'}
              {lead.foundSiteUrl && lead.websiteStatus !== 'live' ? <span className="mt-1 block text-fg-3">Own site, not linked on Google: <a href={lead.foundSiteUrl} target="_blank" rel="noreferrer" className="text-fg hover:underline">{lead.foundSiteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></span> : null}
              {a ? <span className="mt-1 flex flex-wrap gap-1.5">
                {a.lhPerf !== null ? <Chip>Speed {a.lhPerf}</Chip> : null}
                {a.lhSeo !== null ? <Chip>SEO {a.lhSeo}</Chip> : null}
                {a.viewport === false ? <Chip dot="warn">Not mobile friendly</Chip> : null}
                {a.https === false ? <Chip dot="warn">No HTTPS</Chip> : null}
                {a.builder ? <Chip>{a.builder}</Chip> : null}
                {a.copyrightYear ? <Chip>© {a.copyrightYear}</Chip> : null}
              </span> : null}
            </Fact>
            {lead.hours.length ? <Fact label="Hours"><ul className="flex flex-col gap-0.5">{lead.hours.map((h) => <li key={h} className="flex items-start gap-1.5"><Clock className="mt-1 size-3 shrink-0 text-fg-4" aria-hidden />{h}</li>)}</ul></Fact> : null}
            <Fact label="Found by">{lead.sourceQuery}</Fact>
          </dl>
        </Section>

        {lead.currentSiteShot ? (
          <Section title="Their current site">
            <div className="flex justify-center p-4">
              <img src={lead.currentSiteShot} alt={`${lead.name}'s current website on a phone`} loading="lazy" className="max-h-[520px] w-auto rounded-card border border-border-soft" />
            </div>
          </Section>
        ) : null}

        <DangerZone />
      </div>
    </div>
  );
}
