import { AlertCircle, Check, Hand } from 'lucide-react';
import type { RailStep } from '../../../../src/ui/api-types';
import { Dot } from '../../components/ui/chip';
import { cn } from '../../lib/cn';

const STATUS_WORD: Record<RailStep['status'], string> = {
  done: 'done', current: 'in progress', waiting: 'waiting for you', failed: 'failed', todo: 'not started', skipped: 'skipped',
};

/** The build's steps left to right. Checkpoints (the steps that wait for you) carry a hand mark. */
export function ProgressRail({ rail }: { rail: RailStep[] }) {
  return (
    <ol aria-label="Build steps" className="flex items-start gap-0 overflow-x-auto pb-1">
      {rail.map((s, i) => (
        <li key={s.key} className="flex min-w-[88px] flex-1 flex-col items-center gap-2 text-center" aria-current={s.status === 'current' ? 'step' : undefined}>
          <div className="flex w-full items-center">
            <span className={cn('h-px flex-1', i === 0 ? 'bg-transparent' : s.status === 'todo' || s.status === 'skipped' ? 'bg-border-soft' : 'bg-border')} />
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-full border',
              s.status === 'done' && 'border-border bg-white/10 text-fg',
              s.status === 'current' && 'glass-lit text-fg',
              s.status === 'waiting' && 'border-warn/60 text-warn',
              s.status === 'failed' && 'border-bad/60 text-bad',
              (s.status === 'todo' || s.status === 'skipped') && 'border-border-soft text-fg-4')}>
              {s.status === 'done' ? <Check className="size-4" aria-hidden />
                : s.status === 'failed' ? <AlertCircle className="size-4" aria-hidden />
                : s.status === 'current' ? <Dot tone="live" />
                : s.status === 'waiting' ? <Dot tone="warn" />
                : s.checkpoint ? <Hand className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className={cn('h-px flex-1', i === rail.length - 1 ? 'bg-transparent' : rail[i + 1].status === 'todo' || rail[i + 1].status === 'skipped' ? 'bg-border-soft' : 'bg-border')} />
          </div>
          <span className={cn('px-1 text-xs', s.status === 'todo' || s.status === 'skipped' ? 'text-fg-4' : s.status === 'current' ? 'font-medium text-fg' : 'text-fg-2')}>
            {s.label}{s.checkpoint ? <span className="sr-only"> (checkpoint)</span> : null}
            <span className="sr-only">: {STATUS_WORD[s.status]}</span>
          </span>
          {s.checkpoint ? <span className="-mt-1.5 text-[10px] tracking-wide text-fg-4 uppercase" aria-hidden>you</span> : null}
        </li>
      ))}
    </ol>
  );
}
