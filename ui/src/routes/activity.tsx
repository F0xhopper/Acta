import { ArrowLeft, ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Job, JobKind } from '../../../src/ui/api-types';
import { useCancelJob, useJob, useJobs } from '../api';
import { LiveLog } from '../components/live-log';
import { Button, ButtonLink } from '../components/ui/button';
import { Chip, Dot } from '../components/ui/chip';
import { Confirm } from '../components/ui/dialog';
import { Empty } from '../components/ui/empty';
import { Page, Section } from '../components/ui/section';
import { Segmented } from '../components/ui/segmented';
import { SkeletonRows } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/cn';
import { AGENT_KINDS, JOB_LABEL, JOB_STATUS_LABEL, JOB_TONE, clock, duration, timeAgo } from '../lib/format';
import { bizPath } from '../lib/links';

type StatusFilter = 'all' | 'active' | 'failed' | 'done';
const live = (j: Job) => j.status === 'running' || j.status === 'queued';

/** Running and queued first (oldest first, the order they run), then the rest newest first. */
export function orderJobs(jobs: Job[]): Job[] {
  const active = jobs.filter(live).sort((a, b) => a.id - b.id);
  const rest = jobs.filter((j) => !live(j)).sort((a, b) => b.id - a.id);
  return [...active, ...rest];
}

function JobDetail({ id }: { id: number }) {
  const job = useJob(id);
  const cancel = useCancelJob();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  if (job.error) return <ErrorState error={job.error} what="job" />;
  if (!job.data) return <SkeletonRows rows={3} />;
  const j = job.data;
  const isAgent = AGENT_KINDS.includes(j.kind);
  const doCancel = () => cancel.mutate(j.id, {
    onSuccess: () => { setConfirm(false); toast({ kind: 'ok', text: `Cancelled: ${j.label}` }); },
    onError: (e) => toast({ kind: 'error', text: e.message }),
  });
  const slugTarget = j.target && j.kind !== 'search' ? j.target : null;
  return (
    <Section title={<div className="min-w-0"><h2 className="truncate text-sm font-medium">{j.label}</h2><p className="text-xs text-fg-3">{JOB_LABEL[j.kind]} · started {clock(j.startedAt ?? j.createdAt)} · {duration(j.startedAt, j.endedAt)}</p></div>}
      actions={<>
        <Chip dot={JOB_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Chip>
        {slugTarget ? <ButtonLink size="sm" variant="ghost" to={bizPath(slugTarget, 'progress')}>Open business</ButtonLink> : null}
        {live(j) ? <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => (isAgent ? setConfirm(true) : doCancel())}>Cancel</Button> : null}
      </>} bodyClassName="p-4">
      <LiveLog jobId={j.id} height="h-[60vh]" />
      {j.exitCode !== null && j.status === 'failed' ? <p className="mt-2 text-xs text-fg-3">Exited with code {j.exitCode}.</p> : null}
      <Confirm open={confirm} onClose={() => setConfirm(false)} onConfirm={doCancel} busy={cancel.isPending} title="Cancel this run?" confirmLabel="Cancel run">
        The agent stops now. Work so far is committed, and the build can resume from where it stopped.
      </Confirm>
    </Section>
  );
}

export function ActivityPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const jobs = useJobs(200);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<JobKind | ''>('');
  const selected = jobId ? Number(jobId) : undefined;

  const list = useMemo(() => orderJobs(jobs.data ?? []).filter((j) =>
    (!kind || j.kind === kind)
    && (status === 'all' || (status === 'active' ? live(j) : status === 'failed' ? j.status === 'failed' || j.status === 'cancelled' : j.status === 'done'))), [jobs.data, status, kind]);
  const activeCount = jobs.data?.filter(live).length ?? 0;

  return (
    <Page title="Activity" subtitle="Every job the pipeline runs: builds, revisions, searches and screenshots." wide>
      <div className="mx-auto grid max-w-[1400px] gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className={cn('min-w-0', selected !== undefined && 'hidden lg:block')}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented label="Status" value={status} onChange={setStatus} size="sm" options={[
              { value: 'all', label: 'All' }, { value: 'active', label: 'Running', count: activeCount || null }, { value: 'failed', label: 'Failed' }, { value: 'done', label: 'Done' },
            ]} />
            <label htmlFor="job-kind" className="sr-only">Kind</label>
            <select id="job-kind" className="field h-8 w-auto" value={kind} onChange={(e) => setKind(e.target.value as JobKind | '')}>
              <option value="">Every kind</option>
              {(Object.keys(JOB_LABEL) as JobKind[]).map((k) => <option key={k} value={k}>{JOB_LABEL[k]}</option>)}
            </select>
          </div>
          {jobs.error ? <ErrorState error={jobs.error} what="jobs" /> : !jobs.data ? <SkeletonRows rows={6} /> : !list.length ? (
            <Section><Empty icon={ListChecks}>{jobs.data.length ? 'No jobs match these filters.' : 'No jobs yet. Builds and searches you start appear here.'}</Empty></Section>
          ) : (
            <Section bodyClassName="max-h-[70vh] overflow-y-auto">
              <ul className="divide-y divide-border-soft">
                {list.map((j) => (
                  <li key={j.id}>
                    <Link to={`/activity/${j.id}`} aria-current={selected === j.id ? 'true' : undefined}
                      className={cn('flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03]', selected === j.id && 'bg-white/[0.06]')}>
                      <span className="pt-1.5"><Dot tone={JOB_TONE[j.status]} label={JOB_STATUS_LABEL[j.status]} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{j.label}</span>
                        <span className="block truncate text-xs text-fg-3">{JOB_STATUS_LABEL[j.status]} · {live(j) ? (j.status === 'running' ? duration(j.startedAt) : 'waiting') : timeAgo(j.endedAt ?? j.createdAt)}{j.lastLine ? ` · ${j.lastLine}` : ''}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className={cn('min-w-0', selected === undefined && 'hidden lg:block')}>
          {selected !== undefined ? (
            <>
              <button type="button" onClick={() => navigate('/activity')} className="mb-2 inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg lg:hidden"><ArrowLeft className="size-3" aria-hidden />All jobs</button>
              <JobDetail id={selected} />
            </>
          ) : <Section><Empty icon={ListChecks}>Choose a job to see its log.</Empty></Section>}
        </div>
      </div>
    </Page>
  );
}
