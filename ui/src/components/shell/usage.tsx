import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Usage } from '../../../../src/ui/api-types';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';

/** One usage bar: a fill, a hairline at the stop threshold, and the number. Colour only once it matters. */
function Bar({ label, value, stopAt, warnAt }: { label: string; value: number | null; stopAt: number; warnAt: number }) {
  const v = value ?? 0;
  const tone = value === null ? 'bg-fg-4' : v >= stopAt ? 'bg-bad' : v >= warnAt ? 'bg-warn' : 'bg-fg-2';
  return (
    <div className="flex items-center gap-2" title={`${label}: ${value === null ? 'unknown' : `${Math.round(v)}%`}. Agent runs stop at ${stopAt}%.`}>
      <span className="text-xs text-fg-3">{label}</span>
      <span className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-white/10" role="meter" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.min(100, v)}%` }} />
        <span className="absolute inset-y-0 w-px bg-fg-3" style={{ left: `${stopAt}%` }} />
      </span>
      <span className={cn('w-8 text-xs', v >= stopAt ? 'font-semibold text-bad' : 'text-fg-2')}>{value === null ? '—' : `${Math.round(v)}%`}</span>
    </div>
  );
}

export function UsageBars({ usage, refresh }: { usage: Usage | null | undefined; refresh?: boolean }) {
  const qc = useQueryClient();
  if (!usage) return <span className="text-xs text-fg-3">Claude usage unknown</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Bar label="Session" value={usage.session} stopAt={usage.stopAt} warnAt={usage.warnAt} />
      <Bar label="Week" value={usage.week} stopAt={usage.stopAt} warnAt={usage.warnAt} />
      {refresh ? (
        <button type="button" className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg" title={`Read ${timeAgo(usage.at)}. Refresh.`}
          onClick={() => void qc.invalidateQueries({ queryKey: ['usage'] })}><RefreshCw className="size-3" aria-hidden /><span className="sr-only">Refresh usage</span></button>
      ) : null}
    </div>
  );
}

/**
 * Usage in one pill: a small ring for the higher of session and week, coloured only near the limit.
 * Click for both bars, the limit and a refresh.
 */
export function UsagePill({ usage }: { usage: Usage | null | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const top = usage ? Math.max(usage.session ?? 0, usage.week ?? 0) : null;
  const known = usage && (usage.session !== null || usage.week !== null);
  const tone = !known ? 'text-fg-4' : top! >= usage!.stopAt ? 'text-bad' : top! >= usage!.warnAt ? 'text-warn' : 'text-fg-2';
  const r = 7, c = 2 * Math.PI * r;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-border-soft px-3 text-sm text-fg-2 transition-colors hover:text-fg"
        title="Claude usage. Agent runs stop at the limit.">
        <svg viewBox="0 0 18 18" className={cn('size-[18px] -rotate-90', tone)} aria-hidden>
          <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
          {known ? <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(Math.min(100, top!) / 100) * c} ${c}`} /> : null}
        </svg>
        <span>{known ? `${Math.round(top!)}%` : 'Usage'}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Claude usage" className="glass-strong absolute right-0 z-40 mt-2 w-72 rounded-card p-4">
          <p className="text-sm font-medium text-fg">Claude usage</p>
          <p className="mt-1 text-xs text-fg-3">Builds and revisions pause at {usage?.stopAt ?? 70}% so the rest of your week stays usable.</p>
          <div className="mt-3"><UsageBars usage={usage} refresh /></div>
        </div>
      ) : null}
    </div>
  );
}
