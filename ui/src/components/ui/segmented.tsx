import { cn } from '../../lib/cn';

/** A two-to-four way choice. A pill holding pills; the active one is raised. */
export interface SegmentedOption<T extends string> { value: T; label: string; count?: number | null; disabled?: boolean }
export function Segmented<T extends string>({ options, value, onChange, label, className, size = 'md' }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('glass inline-flex items-center gap-0.5 rounded-full p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} disabled={o.disabled} onClick={() => onChange(o.value)}
            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 ring-1 ring-inset transition-colors duration-100', size === 'sm' ? 'h-7 text-xs' : 'h-(--row-h) text-sm',
              active ? 'bg-white/12 font-medium text-fg ring-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]' : 'text-fg-3 ring-transparent hover:text-fg-2', o.disabled && 'opacity-40')}>
            {o.label}
            {o.count !== undefined && o.count !== null ? <span className="text-xs text-fg-3">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
