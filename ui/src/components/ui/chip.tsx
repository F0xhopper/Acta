import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A small filled pill of plain words. Monochrome: the word carries the meaning, an optional dot carries the colour. */
export function Chip({ children, dot, hollow, className, title }: { children: ReactNode; dot?: DotTone; hollow?: boolean; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-(--chip-h) shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap', hollow ? 'border border-border text-fg-2' : 'border border-border-soft bg-white/[0.06] text-fg-2', className)}>
      {dot ? <Dot tone={dot} /> : null}
      {children}
    </span>
  );
}

export type DotTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'live' | 'ring';
const DOT: Record<DotTone, string> = {
  ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-fg-3', muted: 'bg-fg-4',
  live: 'bg-warn animate-pulse-dot', ring: 'bg-transparent ring-1 ring-inset ring-ok',
};

/** The 8px status dot: one of the few marks that keeps a hue. Pair it with words; it is never the only signal. */
export function Dot({ tone, label, className }: { tone: DotTone; label?: string; className?: string }) {
  return <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('inline-block size-2 shrink-0 rounded-full', DOT[tone], className)} />;
}

/** Tier A, B, C or X: a coloured dot and the letter. */
export function TierMark({ tier, className }: { tier: string | null; className?: string }) {
  if (!tier) return <span className={cn('text-xs text-fg-4', className)}>—</span>;
  const tone: DotTone = tier === 'A' ? 'ok' : tier === 'B' ? 'warn' : 'muted';
  return <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-fg-2', className)} title={`Tier ${tier}`}><Dot tone={tone} />{tier}</span>;
}

/** A keyboard key, for hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-md border border-border bg-white/5 px-1 font-mono text-[11px] text-fg-3">{children}</kbd>;
}
