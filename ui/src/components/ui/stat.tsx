import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';

/**
 * A glass tile with a label and a big thin number, as in the reference dashboard.
 * `mark` is an optional status icon above the label. A link (with the corner arrow) when `to` is given.
 */
export function StatTile({ label, value, hint, to, mark, lit, className }: { label: string; value: string | number; hint?: string; to?: string; mark?: ReactNode; lit?: boolean; className?: string }) {
  const body = (
    <div className={cn(lit ? 'glass-lit' : 'glass', 'relative flex h-full flex-col justify-between gap-3 rounded-card px-5 py-4', to && 'transition-[background-color,border-color] duration-150 hover:border-border', className)}>
      {to ? <ArrowUpRight className="absolute top-4 right-4 size-4 text-fg-3" aria-hidden /> : null}
      <div className="flex items-center gap-2">{mark}<span className="text-sm text-fg-2">{label}</span></div>
      <div className="flex items-end justify-between gap-2">
        <span className="num-display text-[34px]">{value}</span>
        {hint ? <span className="truncate pb-1 text-xs text-fg-3">{hint}</span> : null}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-card" aria-label={`${label}: ${value}`}>{body}</Link> : body;
}

/** A big number whose decimals are dimmer, like "78.3 %". */
export function BigNumber({ value, unit, className }: { value: number; unit?: string; className?: string }) {
  const [int, dec] = value.toFixed(1).split('.');
  return <span className={cn('num-display', className)}>{int}<span className="text-fg-4">.{dec}</span>{unit ? <span className="ml-1 text-[0.35em] tracking-normal text-fg-3">{unit}</span> : null}</span>;
}
