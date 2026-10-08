import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A small dropdown menu: a trigger and a list of actions. Arrow keys move, Enter picks, Escape closes.
 * Used for the board's "Move to", the keyboard route for drag and drop.
 */
export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; hint?: string }
export function Menu({ trigger, items, label, align = 'end' }: { trigger: (p: { open: boolean; toggle: () => void; id: string }) => ReactNode; items: MenuItem[]; label: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    setActive(Math.max(0, items.findIndex((i) => !i.disabled)));
    requestAnimationFrame(() => list.current?.focus());
    return () => document.removeEventListener('mousedown', close);
  }, [open, items]);
  const pick = (i: number) => { const it = items[i]; if (!it || it.disabled) return; setOpen(false); it.onSelect(); };
  const onKey = (e: React.KeyboardEvent) => {
    const step = (d: number) => { let i = active; for (let n = 0; n < items.length; n++) { i = (i + d + items.length) % items.length; if (!items[i].disabled) break; } setActive(i); };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); }
  };
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open ? (
        <ul ref={list} id={id} role="menu" aria-label={label} tabIndex={-1} onKeyDown={onKey} aria-activedescendant={`${id}-${active}`}
          className={cn('glass-strong absolute z-40 mt-1 min-w-48 rounded-card p-1 outline-none', align === 'end' ? 'right-0' : 'left-0')}>
          {items.map((it, i) => (
            <li key={it.label} id={`${id}-${i}`} role="menuitem" aria-disabled={it.disabled || undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-[14px] px-3 py-1.5 text-sm', it.disabled ? 'cursor-not-allowed text-fg-4' : 'text-fg-2', i === active && !it.disabled && 'bg-raised text-fg')}>
              <span>{it.label}</span>{it.hint ? <span className="text-xs text-fg-3">{it.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
