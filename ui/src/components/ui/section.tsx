import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A panel with an optional title row. The one container shape in the app. */
export function Section({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('glass rounded-panel', className)}>
      {title || actions ? (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border-soft px-5 py-2.5">
          {typeof title === 'string' ? <h2 className="text-sm font-medium">{title}</h2> : title}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** The page frame: a title row and the page body. */
export function Page({ title, subtitle, actions, children, wide, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn('mx-auto w-full px-4 py-5 md:px-6 md:py-6', wide ? 'max-w-none' : 'max-w-[1180px]', className)}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] leading-tight font-light tracking-[-0.03em] text-fg md:text-[40px]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-fg-3">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
