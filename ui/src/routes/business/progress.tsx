import { Check, Circle, Hammer, Images, Lightbulb, PhoneCall } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BuildDetail } from '../../../../src/ui/api-types';
import { useCancelJob, useJob, useStartBuild, useUsage } from '../../api';
import { useAgentGuard } from '../../components/agent-guard';
import { LiveLog } from '../../components/live-log';
import { UsageBars } from '../../components/shell/usage';
import { Button, ButtonLink } from '../../components/ui/button';
import { Dot } from '../../components/ui/chip';
import { Confirm } from '../../components/ui/dialog';
import { Empty } from '../../components/ui/empty';
import { MarkdownFile } from '../../components/ui/markdown';
import { Notice } from '../../components/ui/notice';
import { Section } from '../../components/ui/section';
import { Segmented } from '../../components/ui/segmented';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { clock, duration, timeAgo, BUILD_LABEL } from '../../lib/format';
import { useBusiness } from './context';
import { ProgressRail } from './progress-rail';
import { bizPath } from '../../lib/links';

const STUCK_MS = 10 * 60_000;

/** Re-render every `ms` so elapsed times and "N min ago" stay current. */
function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function ProgressTab() {
  const { slug, lead, build, buildLoading } = useBusiness();
  const guard = useAgentGuard();
  const start = useStartBuild();
  const toast = useToast();

  if (buildLoading) return <SkeletonRows rows={4} />;
  if (!build) {
    return (
      <Section>
        <Empty icon={Hammer} action={<Button variant="primary" loading={start.isPending} onClick={() => void guard(`Build ${lead.name}`, (override) => start.mutateAsync({ slug, override })).then((j) => { if (j) toast({ kind: 'ok', text: `Build queued for ${lead.name}` }); })}>Build the site</Button>}>
          No build has started for this business yet.
        </Empty>
      </Section>
    );
  }
  return <BuildProgress build={build} />;
}

function BuildProgress({ build }: { build: BuildDetail }) {
  const { slug } = useBusiness();
  const job = useJob(build.activeJobId ?? undefined);
  const now = useNow();
  const running = build.activeJobId !== null && job.data?.status === 'running';
  const current = build.rail.find((r) => r.status === 'current')?.label ?? build.rail.find((r) => r.status === 'todo')?.label ?? null;
  const lastEventAt = build.events.length ? build.events[build.events.length - 1].at : null;
  const lastSignal = [lastEventAt, build.agent?.lastCommit?.at ?? null, job.data?.startedAt ?? null].filter(Boolean).map((t) => new Date(t!).getTime());
  const stuck = running && lastSignal.length > 0 && now - Math.max(...lastSignal) > STUCK_MS;

  return (
    <div className="flex flex-col gap-4">
      <Section bodyClassName="px-4 py-5"><ProgressRail rail={build.rail} /></Section>

      {build.state === 'awaiting_call' ? (
        <Notice tone="warn" title="Nothing is built until you've called them" action={<ButtonLink to={bizPath(slug, 'overview')} variant="primary" size="sm"><PhoneCall className="size-3.5" aria-hidden />See the script</ButtonLink>}>
          They can't be cold emailed, so the first contact is a call either way. Thirty seconds now turns this into a site they asked to see.
        </Notice>
      ) : null}
      {build.state === 'awaiting_photos' ? (
        <Notice tone="warn" title="The build is waiting for you to sort the photos" action={<ButtonLink to={bizPath(slug, 'photos')} variant="primary" size="sm"><Images className="size-3.5" aria-hidden />Sort photos</ButtonLink>}>
          Keep, drop or choose the hero, then the build carries on with research.
        </Notice>
      ) : null}
      {build.state === 'awaiting_concept' ? (
        <Notice tone="warn" title="The build is waiting for you to choose a concept" action={<ButtonLink to={bizPath(slug, 'concepts')} variant="primary" size="sm"><Lightbulb className="size-3.5" aria-hidden />Choose a concept</ButtonLink>}>
          Three design directions are ready. The agent builds the one you pick.
        </Notice>
      ) : null}
      {build.state === 'awaiting_usage' && build.activeJobId === null ? <UsagePausedNotice build={build} /> : null}
      {stuck ? <StuckNotice build={build} current={current} /> : null}
      {build.state === 'failed' ? <FailedPanel build={build} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <NowPanel build={build} running={running} current={current} now={now} />
        <DocsPanel build={build} now={now} />
      </div>

      <Section title={build.activeJobId !== null ? 'Live log' : 'Build events'} bodyClassName="p-4">
        {build.activeJobId !== null ? <LiveLog jobId={build.activeJobId} height="h-96" /> : <EventLog build={build} />}
      </Section>
    </div>
  );
}

/** What the Now card says once nothing is running. */
const DONE_HEADLINE: Partial<Record<BuildDetail['state'], string>> = {
  preview_ready: 'Finished. Ready for your review.', approved: 'Approved and ready to send.', awaiting_photos: 'Waiting for you to sort the photos.', awaiting_call: 'Waiting for your call before the build.',
  awaiting_concept: 'Waiting for you to choose a concept.', awaiting_usage: 'Paused at the Claude usage limit.', picked: 'Queued. It starts when the build begins.', torn_down: 'Taken down.', live: 'Live.',
};

function NowPanel({ build, running, current, now }: { build: BuildDetail; running: boolean; current: string | null; now: number }) {
  const usage = useUsage();
  const elapsedMin = build.startedAt ? (now - new Date(build.startedAt).getTime()) / 60_000 : null;
  const agent = build.agent;
  const headline = build.state === 'revising' ? `Making your requested changes (round ${build.rounds})` : build.activeJobId !== null ? agent?.current ?? current ?? 'Starting' : build.state === 'failed' ? 'Stopped' : agent?.current ?? DONE_HEADLINE[build.state] ?? BUILD_LABEL[build.state];
  return (
    <section className="glass flex flex-col gap-5 rounded-panel p-5" aria-label="Now">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-fg-2">{running ? <Dot tone="live" /> : null}Now</p>
          <p className="num-display mt-2 text-[28px] md:text-[34px]">{headline}</p>
        </div>
        {build.activeJobId !== null ? <CancelButton build={build} current={current} /> : null}
      </div>

      {agent?.phases.length ? (
        <ul className="flex flex-col gap-1.5" aria-label="Agent phases">
          {agent.phases.map((p) => {
            const isCurrent = !p.done && p.label === agent.current;
            return (
              <li key={p.key} className={cn('flex items-center gap-2.5 text-sm', p.done ? 'text-fg-2' : isCurrent ? 'font-medium text-fg' : 'text-fg-4')}>
                {p.done ? <Check className="size-4 text-ok" aria-hidden /> : isCurrent && running ? <span className="grid size-4 place-items-center"><Dot tone="live" /></span> : <Circle className="size-4" aria-hidden />}
                <span>{p.label}</span>
                <span className="sr-only">{p.done ? ' (done)' : isCurrent ? ' (in progress)' : ''}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {agent?.lastCommit ? (
        <div className="rounded-card border border-border-soft bg-white/[0.03] px-3.5 py-2.5">
          <p className="label">Last commit</p>
          <p className="mt-1 text-sm break-words text-fg">{agent.lastCommit.message}</p>
          <p className="mt-0.5 text-xs text-fg-3">{timeAgo(agent.lastCommit.at)}</p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Stat label="Elapsed" value={build.startedAt && build.activeJobId !== null ? duration(build.startedAt) : '—'} hint={elapsedMin !== null && build.activeJobId !== null ? `of ${build.maxMinutes} min cap` : undefined} warn={elapsedMin !== null && build.activeJobId !== null && elapsedMin > build.maxMinutes * 0.85} />
        <Stat label="Agent time" value={build.agentMinutes !== null ? `${build.agentMinutes} min` : '—'} />
        <Stat label="Turns" value={build.agentTurns !== null ? String(build.agentTurns) : '—'} hint={`cap ${build.maxTurns}`} />
        <Stat label="Cost" value={build.agentCostUsd !== null ? `$${build.agentCostUsd.toFixed(2)}` : '—'} hint={build.agentCostUsd !== null ? 'estimate' : undefined} />
      </dl>

      <div>
        <p className="label mb-1.5">Claude usage</p>
        <UsageBars usage={usage.data} />
      </div>
    </section>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={cn('mt-1 text-lg font-light tracking-tight', warn ? 'text-warn' : 'text-fg')}>{value}</dd>
      {hint ? <dd className="text-xs text-fg-3">{hint}</dd> : null}
    </div>
  );
}

function CancelButton({ build, current, size = 'sm' }: { build: BuildDetail; current: string | null; size?: 'sm' | 'md' }) {
  const cancel = useCancelJob();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (build.activeJobId === null) return null;
  const id = build.activeJobId;
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>Cancel build</Button>
      <Confirm open={open} onClose={() => setOpen(false)} title="Cancel this build?" confirmLabel="Cancel build" busy={cancel.isPending}
        onConfirm={() => cancel.mutate(id, {
          onSuccess: () => { setOpen(false); toast({ kind: 'ok', text: 'Build cancelled. It can resume later.' }); },
          onError: (e) => { setOpen(false); toast({ kind: 'error', text: `Couldn't cancel: ${e.message}` }); },
        })}>
        The build stops. It can resume from {current ? current.toLowerCase() : 'where it stopped'}.
      </Confirm>
    </>
  );
}

function StuckNotice({ build, current }: { build: BuildDetail; current: string | null }) {
  return (
    <Notice tone="warn" title="Nothing new for ten minutes" action={<CancelButton build={build} current={current} />}>
      The agent may be thinking through a long step, or it may be stuck. Check the log below before cancelling.
    </Notice>
  );
}

/** Paused at the usage limit: nothing for you to do, it carries on by itself. "Continue now" goes past the limit. */
function UsagePausedNotice({ build }: { build: BuildDetail }) {
  const { slug, lead } = useBusiness();
  const guard = useAgentGuard();
  const start = useStartBuild();
  const toast = useToast();
  const go = () => guard(`Continue ${lead.name}`, (override) => start.mutateAsync({ slug, override })).then((j) => { if (j) toast({ kind: 'ok', text: `Continue ${lead.name}: queued` }); });
  return (
    <Notice tone="info" title={`Paused at the Claude usage limit${build.failedStep ? `, in ${build.failedStep}` : ''}`}
      action={<Button size="sm" variant="outline" loading={start.isPending} onClick={() => void go()}>Continue now</Button>}>
      The agent's conversation is saved. Once usage is back under the limit it carries on where it stopped, without redoing anything. The UI checks every five minutes.
    </Notice>
  );
}

function FailedPanel({ build }: { build: BuildDetail }) {
  const { slug, lead } = useBusiness();
  const guard = useAgentGuard();
  const start = useStartBuild();
  const toast = useToast();
  const [confirmOver, setConfirmOver] = useState(false);
  const failing = build.gates?.filter((g) => !g.pass) ?? [];
  const step = build.failedStep;
  const run = (label: string, vars: { from?: string; force?: boolean }) =>
    guard(label, (override) => start.mutateAsync({ slug, ...vars, override })).then((j) => { if (j) toast({ kind: 'ok', text: `${label}: queued` }); });

  return (
    <Section title={<h2 className="flex items-center gap-2 text-sm font-medium"><Dot tone="bad" />Build failed{step ? ` at ${step}` : ''}</h2>}
      actions={<>
        {step ? <Button size="sm" variant="primary" loading={start.isPending} onClick={() => void run(`Retry ${lead.name} from ${step}`, { from: step })}>Retry from {step}</Button> : null}
        <Button size="sm" variant="outline" onClick={() => setConfirmOver(true)}>Start over</Button>
      </>}
      bodyClassName="flex flex-col gap-4 p-5">
      {build.lastError ? <pre className="max-h-56 overflow-auto rounded-card border border-border-soft bg-white/[0.03] p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-fg-2">{build.lastError}</pre> : <p className="text-sm text-fg-3">No error message was recorded. Check the build events below.</p>}
      {failing.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Gate results</caption>
            <thead><tr className="text-fg-3"><th className="label py-1.5 pr-4 font-medium">Gate</th><th className="label py-1.5 pr-4 font-medium">Value</th><th className="label py-1.5 pr-4 font-medium">Threshold</th><th className="label py-1.5 font-medium">Result</th></tr></thead>
            <tbody>
              {build.gates!.map((g) => (
                <tr key={g.name} className="border-t border-border-soft align-top">
                  <td className="py-2 pr-4 text-fg">{g.name}{g.details?.length ? <ul className="mt-1 text-xs text-fg-3">{g.details.slice(0, 4).map((d) => <li key={d}>{d}</li>)}</ul> : null}</td>
                  <td className="py-2 pr-4">{g.value ?? '—'}</td>
                  <td className="py-2 pr-4 text-fg-3">{g.threshold ?? '—'}</td>
                  <td className="py-2"><span className="inline-flex items-center gap-1.5"><Dot tone={g.pass ? 'ok' : 'bad'} />{g.pass ? 'Pass' : 'Fail'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Confirm open={confirmOver} onClose={() => setConfirmOver(false)} title="Start the build over?" confirmLabel="Start over" busy={start.isPending}
        onConfirm={() => { setConfirmOver(false); void run(`Rebuild ${lead.name}`, { force: true }); }}>
        This gathers the brand again and rebuilds the site from the start, replacing the current work.
      </Confirm>
    </Section>
  );
}

function DocsPanel({ build, now }: { build: BuildDetail; now: number }) {
  const docs = build.docs;
  const [picked, setPicked] = useState<string | null>(null);
  const active = docs.find((d) => d.name === picked) ?? docs[docs.length - 1];
  void now;
  return (
    <Section title="Documents" actions={active ? <span className="text-xs text-fg-3">updated {timeAgo(active.updatedAt)}</span> : null} bodyClassName="flex min-h-0 flex-col">
      {docs.length ? (
        <>
          <div className="overflow-x-auto px-4 pt-3">
            <Segmented size="sm" label="Document" value={active.name} onChange={setPicked} options={docs.map((d) => ({ value: d.name, label: d.name.replace(/\.md$/, '') }))} />
          </div>
          <div className="max-h-[520px] overflow-auto px-5 pb-5"><MarkdownFile key={active.url} url={active.url} version={active.updatedAt} className="pt-2" /></div>
        </>
      ) : <Empty>The agent's plan, concepts and brief appear here as it writes them.</Empty>}
    </Section>
  );
}

function EventLog({ build }: { build: BuildDetail }) {
  if (!build.events.length) return <p className="text-sm text-fg-3">No events recorded yet.</p>;
  return (
    <div role="log" className="glass max-h-96 overflow-auto rounded-card p-3 font-mono text-xs leading-5 text-fg-2">
      {build.events.map((e, i) => (
        <div key={i} className={cn('break-words whitespace-pre-wrap', e.level === 'error' && 'text-bad', e.level === 'warn' && 'text-warn')}>
          <span className="text-fg-4">{clock(e.at)}</span>{e.step ? <span className="text-fg-3"> {e.step}</span> : null} {e.message}
        </div>
      ))}
    </div>
  );
}
