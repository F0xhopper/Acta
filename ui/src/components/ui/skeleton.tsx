import { cn } from '../../lib/cn';
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-skeleton rounded-card bg-white/[0.06]', className)} />;
}
/** A page-shaped placeholder: a few rows of skeleton. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return <div role="status" aria-label="Loading" className={cn('flex flex-col gap-2', className)}>{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>;
}
