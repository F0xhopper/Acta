import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** One faint icon, one sentence, one button. The sentence says what to do next and the button does it. */
export function Empty({ icon: Icon, children, action, className }: { icon?: ComponentType<{ className?: string }>; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {Icon ? <Icon className="size-7 text-fg-4" aria-hidden /> : null}
      <p className="max-w-sm text-sm text-fg-3">{children}</p>
      {action}
    </div>
  );
}
