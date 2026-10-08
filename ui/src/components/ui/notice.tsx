import { AlertTriangle, CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A rounded notice. Monochrome: a panel with a hairline, the stronger hairline when something is wrong; the icon and words carry the meaning. */
export type NoticeTone = 'bad' | 'warn' | 'info' | 'ok';
const ICON = { bad: CircleAlert, warn: AlertTriangle, info: Info, ok: CircleCheck };
const ICON_TONE = { bad: 'text-bad', warn: 'text-warn', info: 'text-fg-3', ok: 'text-ok' };

export function Notice({ tone = 'info', title, children, action, className }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('rounded-card border bg-panel px-3.5 py-3 text-fg', tone === 'bad' || tone === 'warn' ? 'border-border' : 'border-border-soft', className)}>
      <div className="flex gap-2.5">
        <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[tone])} aria-hidden />
        <div className="min-w-0 flex-1">
          {title ? <p className="text-sm font-medium">{title}</p> : null}
          {children ? <div className={cn('text-sm text-fg-2', title ? 'mt-1' : '')}>{children}</div> : null}
          {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
