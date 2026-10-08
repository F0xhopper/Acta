import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router';
import type { BoardColumn, BusinessTab, InboxItem, InboxKind, Summary } from '../../../src/ui/api-types';
import { bizPath } from '../lib/links';
import { useStartBuild, useSummary } from '../api';
import { useAgentGuard } from '../components/agent-guard';
import { Button, ButtonLink } from '../components/ui/button';
import { Dot, type DotTone } from '../components/ui/chip';
import { Empty } from '../components/ui/empty';
import { Section, Page } from '../components/ui/section';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/cn';
import { COLUMN_LABEL, duration, plural, timeAgo } from '../lib/format';

/** Kinds in the order they unblock the most. */
export const KIND_ORDER: InboxKind[] = ['failed', 'photos', 'concept', 'review', 'send', 'followup', 'reply'];
const KIND: Record<InboxKind, { label: string; action: string; tone: DotTone }> = {
  failed: { label: 'Build failed', action: 'Retry', tone: 'bad' },
  photos: { label: 'Needs photos', action: 'Sort photos', tone: 'warn' },
  concept: { label: 'Needs a concept', action: 'Choose a concept', tone: 'warn' },
  review: { label: 'To review', action: 'Review site', tone: 'warn' },
  send: { label: 'Ready to send', action: 'Send pitch', tone: 'ok' },
  followup: { label: 'Follow up', action: 'Follow up', tone: 'info' },
  reply: { label: 'Replied', action: 'Log outcome', tone: 'info' },
};
export const sortInbox = (items: InboxItem[]) =>
  [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.at.localeCompare(b.at));

const COUNT_COLUMNS: BoardColumn[] = ['picked', 'building', 'preview', 'ready', 'sent', 'replied', 'won'];
const bizUrl = (slug: string, tab: BusinessTab) => bizPath(slug, tab);

/** A slim strip of the pipeline, linking to the board. The board is where the detail lives. */
function Strip({ s }: { s: Summary }) {
  return (
    <Link to="/pipeline" className="glass mb-5 flex items-stretch overflow-x-auto rounded-full px-2 py-1.5 transition-colors hover:border-border" aria-label="Open the pipeline board">
      {COUNT_COLUMNS.map((c, i) => (
        <span key={c} className={cn('flex shrink-0 items-baseline gap-2 px-4 py-1', i > 0 && 'border-l border-border-soft')}>
          <span className="num-display text-[22px]">{s.counts[c] ?? 0}</span>
          <span className="text-xs whitespace-nowrap text-fg-3">{COLUMN_LABEL[c]}</span>
        </span>
      ))}
    </Link>
  );
}

function NeedsRow({ item }: { item: InboxItem }) {
  const guard = useAgentGuard();
  const start = useStartBuild();
  const toast = useToast();
  const k = KIND[item.kind];
  const retry = () => void guard(`Retrying the build for ${item.name}`, (override) => start.mutateAsync({ slug: item.slug, override }))
    .then((job) => { if (job) toast({ kind: 'ok', text: `Retrying ${item.name}`, link: { to: bizUrl(item.slug, 'progress'), label: 'Watch progress' } }); });
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <span className="flex w-36 shrink-0 items-center gap-2 text-sm text-fg-2"><Dot tone={k.tone} />{k.label}</span>
      <Link to={bizUrl(item.slug, item.tab)} className="min-w-0 flex-1 rounded-md hover:underline hover:underline-offset-2">
        <span className="block truncate font-medium text-fg">{item.name}</span>
        <span className="block truncate text-sm text-fg-3">{item.detail} · {timeAgo(item.at)}</span>
      </Link>
      {item.kind === 'failed'
        ? <div className="flex gap-2"><ButtonLink size="sm" variant="ghost" to={bizUrl(item.slug, 'progress')}>View log</ButtonLink><Button size="sm" variant="primary" loading={start.isPending} onClick={retry}>{k.action}</Button></div>
        : <ButtonLink size="sm" variant={item.kind === 'reply' ? 'secondary' : 'primary'} to={bizUrl(item.slug, item.tab)}>{k.action}</ButtonLink>}
    </li>
  );
}

export function InboxPage() {
  const q = useSummary();
  if (q.error) return <Page title="Inbox"><ErrorState error={q.error} what="the inbox" /></Page>;
  if (!q.data) return (
    <Page title="Inbox"><div className="mb-5 flex gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20 w-28" />)}</div><Skeleton className="h-64" /></Page>
  );
  const s = q.data;
  const items = sortInbox(s.needsYou);
  return (
    <Page title="Inbox" subtitle={items.length ? `${plural(items.length, 'thing')} need${items.length === 1 ? 's' : ''} you` : 'Nothing needs you right now'} className="max-w-[920px]">
      <Strip s={s} />
      <div className="flex flex-col gap-4">
        <Section title={<h2 className="text-sm font-medium">Needs you {items.length ? <span className="text-fg-3">({items.length})</span> : null}</h2>}>
          {items.length ? <ul className="divide-y divide-border-soft">{items.map((i) => <NeedsRow key={`${i.kind}-${i.slug}`} item={i} />)}</ul> : (
            <Empty icon={CheckCircle2} action={<ButtonLink to="/leads" variant="primary">Find businesses</ButtonLink>}>
              You're all caught up. Find businesses worth building a site for, and pick a few.
            </Empty>
          )}
        </Section>
        {s.running.length ? (
          <Section title="In progress">
            <ul className="divide-y divide-border-soft">
              {s.running.map((j) => (
                <li key={j.id}>
                  <Link to={j.slug ? bizUrl(j.slug, 'progress') : `/activity/${j.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03]">
                    <Dot tone={j.status === 'running' ? 'live' : 'muted'} label={j.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{j.label}</span>
                      <span className="block truncate text-xs text-fg-3">{j.status === 'queued' ? 'Waiting to start' : j.step ?? j.lastLine ?? 'Starting'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-fg-3">{j.status === 'running' ? duration(j.startedAt) : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
