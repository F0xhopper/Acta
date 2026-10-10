import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Autopilot } from '../../../src/ui/api-types';
import { useAutopilot, useSetAutopilot } from '../api';
import { bizPath } from '../lib/links';
import { cn } from '../lib/cn';
import { timeAgo } from '../lib/format';
import { useDismiss } from '../lib/use-dismiss';
import { Button } from './ui/button';
import { Dot, type DotTone } from './ui/chip';
import { useToast } from './ui/toast';

/** Waiting on something only you can clear, or on usage: an amber dot. Off: grey. Running: green. */
export const autopilotTone = (a: Autopilot): DotTone => !a.on ? 'muted' : a.usage || a.unreviewed >= a.maxUnreviewed ? 'warn' : 'ok';

export const CHORE_LABEL: Record<NonNullable<Autopilot['nextChore']>['kind'], string> = { leads: 'lead search', day: 'housekeeping', week: 'weekly re-score' };
const dayClock = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** The switch itself, shared by the header pill and the Inbox panel: flips it, then says what that means. */
export function useAutopilotSwitch() {
  const q = useAutopilot();
  const set = useSetAutopilot();
  const toast = useToast();
  const a = q.data ?? null;
  const toggle = () => { if (a) set.mutate(!a.on, {
    onSuccess: (r) => toast({ kind: 'ok', text: r.on ? 'Autopilot is on: it picks the best passer, builds it and tells you when the site is ready.' : 'Autopilot is off. A build already running finishes; it starts nothing new.' }),
    onError: (err) => toast({ kind: 'error', text: err.message }),
  }); };
  return { a, toggle, pending: set.isPending };
}

/** The counts in one line: how far through the day's allowance it is, what is waiting, what comes next. */
export function AutopilotCounts({ a, className }: { a: Autopilot; className?: string }) {
  return (
    <p className={cn('text-xs leading-6 text-fg-3', className)}>
      Builds today {a.buildsToday}/{a.maxBuildsPerDay} · previews waiting {a.unreviewed}/{a.maxUnreviewed} · picked queue {a.queued}
      {a.nextChore ? <> · next {CHORE_LABEL[a.nextChore.kind]} {dayClock(a.nextChore.at)}</> : null}
      {a.lastPick ? <> · last pick <Link to={bizPath(a.lastPick.slug)} className="text-fg-2 underline underline-offset-2">{a.lastPick.name}</Link> {timeAgo(a.lastPick.at)}</> : null}
    </p>
  );
}

export function AutopilotSwitch({ a, toggle, pending, size = 'sm' }: { a: Autopilot; toggle: () => void; pending: boolean; size?: 'sm' | 'md' }) {
  return (
    <Button size={size} variant={a.on ? 'ghost' : 'secondary'} role="switch" aria-checked={a.on} loading={pending} onClick={toggle}
      title={a.on ? 'Stop it starting anything new. A build already running finishes' : 'Pick the best lead that passes every gate, build it, and tell you when it is ready to review'}>
      {a.on ? 'Turn off' : 'Turn on'}
    </Button>
  );
}

/**
 * The autopilot in the header, on every page: a dot and the word, so you always know whether the pipeline is
 * running itself. Click for the reason, the counts and the switch.
 */
export function AutopilotPill() {
  const { a, toggle, pending } = useAutopilotSwitch();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  if (!a) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors', a.on ? 'border-border-soft text-fg-2 hover:text-fg' : 'border-transparent text-fg-3 hover:text-fg-2')}
        title={a.reason}>
        <Dot tone={autopilotTone(a)} />
        <span>Autopilot <span className="text-fg-3">{a.on ? 'on' : 'off'}</span></span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Autopilot" className="glass-strong absolute right-0 z-40 mt-2 w-80 rounded-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-fg">Autopilot {a.on ? 'on' : 'off'}</p>
            <AutopilotSwitch a={a} toggle={toggle} pending={pending} />
          </div>
          <p className="mt-2 text-sm text-fg-2">{a.reason}</p>
          <AutopilotCounts a={a} className="mt-1" />
          {!a.on ? <p className="mt-1 text-xs leading-6 text-fg-3">On, it picks the best lead that passes every gate, builds it, and tells you when the site is ready to review. It stops at the Claude usage limit.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
