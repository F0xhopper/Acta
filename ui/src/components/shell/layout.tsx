import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useJobs, useMeta, useSummary, useUsage } from '../../api';
import { cn } from '../../lib/cn';
import { UsagePill } from './usage';
import { Dot } from '../ui/chip';

const NAV = [
  { to: '/', label: 'Inbox' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/leads', label: 'Leads' },
];

function ServerBanner() {
  const meta = useMeta();
  if (!meta.error?.unreachable) return null;
  return (
    <div role="alert" className="glass mx-4 mt-3 rounded-card px-4 py-2.5 text-sm text-fg md:mx-6">
      <strong className="font-semibold">The Acta server isn't running.</strong> Start it in the project folder with <code className="rounded bg-white/10 px-1 font-mono text-xs">pnpm ui</code>. Retrying every 15 seconds.
    </div>
  );
}

/** The Acta mark: four slashes, after the reference's logo. */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="size-7 text-fg" aria-hidden>
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M${4 + i * 5} 22 L${10 + i * 5} 6`} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity={1 - i * 0.18} />)}
    </svg>
  );
}

/** The window: a top bar with the mark, the pill navigation and the usage meter, then the page. */
export function Layout() {
  const usage = useUsage();
  const jobs = useJobs(30);
  const summary = useSummary();
  const location = useLocation();
  const running = jobs.data?.filter((j) => j.status === 'running' || j.status === 'queued').length ?? 0;
  const needs = summary.data?.needsYou.length ?? 0;
  useEffect(() => { document.title = needs ? `(${needs}) Acta` : 'Acta'; }, [needs]);
  useEffect(() => { document.getElementById('main')?.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-panel-solid focus:px-3 focus:py-1.5">Skip to content</a>
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-4 pb-2 md:px-6 md:pt-5">
        <NavLink to="/" className="flex items-center gap-2.5 rounded-full" aria-label="Acta, inbox"><Mark /><span className="hidden text-[15px] font-medium tracking-tight text-fg sm:inline">Acta</span></NavLink>
        <nav aria-label="Main" className="order-3 w-full overflow-x-auto md:order-none md:w-auto">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => {
              const badge = n.to === '/' ? needs : 0;
              return (
                <li key={n.to}>
                  <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => cn('relative flex h-10 items-center gap-2 rounded-full px-4 text-[15px] whitespace-nowrap transition-colors duration-150',
                    isActive ? 'glass text-fg' : 'border border-transparent text-fg-3 hover:text-fg-2')}>
                    <span>{n.label}</span>
                    {badge ? <span className={cn('min-w-5 rounded-full px-1.5 text-center text-xs font-semibold', n.to === '/' ? 'bg-accent text-accent-fg' : 'bg-white/10 text-fg-2')} aria-label={`${badge} need you`}>{badge}</span> : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NavLink to="/activity" className={({ isActive }) => cn('inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition-colors', running ? 'glass text-fg' : 'text-fg-3 hover:text-fg-2', isActive && 'text-fg')}
            title="Every job the pipeline has run, with logs">
            {running ? <><Dot tone="live" /><span>{running} running</span></> : <span>Activity</span>}
          </NavLink>
          <UsagePill usage={usage.data} />
        </div>
      </header>
      <ServerBanner />
      <main id="main" className="scroll-col flex-1"><Outlet /></main>
    </div>
  );
}
