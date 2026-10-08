import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';

/** Tabs that are links, so the tab is in the address and the back button works. */
export function LinkTabs({ tabs, label }: { tabs: { to: string; label: string; badge?: string | number | null; dot?: boolean; end?: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} replace
          className={({ isActive }) => cn('relative inline-flex h-10 items-center gap-1.5 border-b-2 px-3.5 text-sm whitespace-nowrap transition-colors',
            isActive ? 'border-fg font-medium text-fg' : 'border-transparent text-fg-3 hover:text-fg-2')}>
          {t.label}
          {t.dot ? <span aria-label="needs you" className="size-1.5 rounded-full bg-fg" /> : null}
          {t.badge !== undefined && t.badge !== null && t.badge !== '' ? <span className="rounded-full bg-white/10 px-1.5 text-xs text-fg-3">{t.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
