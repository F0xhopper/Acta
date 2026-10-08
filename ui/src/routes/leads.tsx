import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { LeadSummary, PipelineStatus } from '../../../src/ui/api-types';
import { useLeads, useMeta, usePick, useSearch, useStartBuild, useSummary, type LeadFilters } from '../api';
import { useAgentGuard } from '../components/agent-guard';
import { Button } from '../components/ui/button';
import { Chip, Dot, TierMark } from '../components/ui/chip';
import { Empty } from '../components/ui/empty';
import { Page, Section } from '../components/ui/section';
import { SkeletonRows } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/cn';
import { CHANNEL_LABEL, SITE_STATUS_LABEL, STATUS_LABEL, stageOf } from '../lib/format';

const TIERS = ['A', 'B', 'C', 'X'];
const PAGE = 200;
type SortKey = 'score' | 'name' | 'reviews' | 'rating';

/** Filters live in the address, so a filtered list can be bookmarked. Tier defaults to A and B; "all" clears it. */
export function filtersFrom(p: URLSearchParams): LeadFilters {
  const t = p.get('tier');
  return {
    tier: t === 'all' ? undefined : (t ?? 'A,B').split(',').filter((x) => TIERS.includes(x)),
    category: p.get('category') || undefined,
    area: p.get('area') || undefined,
    status: p.get('status') || undefined,
    q: p.get('q') || undefined,
  };
}

const canPick = (l: LeadSummary) => l.status === 'new';
function StageChip({ l }: { l: LeadSummary }) { const st = stageOf(l.status, l.buildState); return <Chip dot={st.tone}>{st.label}</Chip>; }
/** Picking creates a queued build record, so a picked lead can be unpicked until its build actually starts. */
const canUnpick = (l: LeadSummary) => l.status === 'shortlisted' && (!l.buildState || l.buildState === 'picked');

const TIER_HINT: Record<string, string> = { A: 'Tier A: the best fit. No working site, strong reviews.', B: 'Tier B: a good fit.', C: 'Tier C: a weak fit.', X: 'Tier X: not worth pitching.' };

/** Find new businesses: the search, what's running, and what recent searches found. */
function FindPanel() {
  const [q, setQ] = useState('');
  const search = useSearch();
  const summary = useSummary();
  const toast = useToast();
  const running = summary.data?.running.filter((j) => j.kind === 'search') ?? [];
  const recent = summary.data?.discovery.recentSearches ?? [];
  const run = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim(); if (!query) return;
    search.mutate(query, {
      onSuccess: () => { setQ(''); toast({ kind: 'ok', text: `Searching "${query}". New leads appear in the list when it finishes.` }); },
      onError: (err) => toast({ kind: 'error', text: `The search didn't start: ${err.message}` }),
    });
  };
  return (
    <section className="glass mb-4 rounded-panel p-4 md:p-5" aria-labelledby="find-h">
      <h2 id="find-h" className="text-sm font-medium">Find new businesses</h2>
      <p className="mt-0.5 text-xs text-fg-3">A trade and an area. Each result is checked for a website, matched with Companies House and scored.</p>
      <form role="search" onSubmit={run} className="mt-3 flex gap-2">
        <label htmlFor="lead-search" className="sr-only">Trade and area</label>
        <input id="lead-search" className="field flex-1" placeholder="e.g. barbers in Moseley" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="primary" loading={search.isPending} disabled={!q.trim()}><Search className="size-4" aria-hidden />Search</Button>
      </form>
      {running.map((j) => (
        <p key={j.id} className="mt-3 flex items-center gap-2 text-sm text-fg-2"><Dot tone="live" />{j.status === 'queued' ? 'Waiting to search' : 'Searching'} {j.target ? `"${j.target}"` : ''}… <Link to={`/activity/${j.id}`} className="text-xs text-fg-3 underline underline-offset-2">details</Link></p>
      ))}
      {recent.length ? (
        <p className="mt-3 text-xs leading-6 text-fg-3">
          Recent: {recent.slice(0, 5).map((r, i) => <span key={r.query}>{i ? ' · ' : ''}<span className="text-fg-2">{r.query}</span> ({r.tierAB} good of {r.found})</span>)}
        </p>
      ) : null}
    </section>
  );
}

function SortHeader({ k, label, sort, setSort, className }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('px-3 py-2 font-normal', className)}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === 'name' ? 1 : -1 })}>
        {label}{active ? (sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : null}
      </button>
    </th>
  );
}

export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const leads = useLeads(filters);
  const meta = useMeta();
  const pick = usePick();
  const start = useStartBuild();
  const guard = useAgentGuard();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });
  const [busy, setBusy] = useState(false);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key); else next.set(key, value);
    setParams(next, { replace: true }); setLimit(PAGE); setSelected(new Set());
  };
  const tiers = filters.tier ?? [];
  const toggleTier = (t: string) => {
    const now = filters.tier === undefined ? [] : tiers;
    const next = now.includes(t) ? now.filter((x) => x !== t) : [...now, t].sort();
    set('tier', next.length ? next.join(',') : 'all');
  };

  const rows = useMemo(() => {
    const list = [...(leads.data ?? [])];
    const val = (l: LeadSummary) => (sort.key === 'name' ? l.name.toLowerCase() : sort.key === 'reviews' ? l.reviews : sort.key === 'rating' ? (l.rating ?? -1) : (l.score ?? -1));
    return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [leads.data, sort]);
  const shown = rows.slice(0, limit);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const chosen = [...selected].map((s) => bySlug.get(s)).filter((x): x is LeadSummary => !!x);

  const togglePick = (l: LeadSummary, on: boolean) => pick.mutate({ slug: l.slug, pick: on }, {
    onSuccess: (r) => {
      if (!r.ok) { toast({ kind: 'error', text: r.message }); return; }
      toast({ kind: 'ok', text: on ? `Picked ${l.name}` : `Unpicked ${l.name}`, action: { label: 'Undo', onClick: () => pick.mutate({ slug: l.slug, pick: !on }) } });
    },
    onError: (e) => toast({ kind: 'error', text: e.message }),
  });

  const pickSelected = async () => {
    setBusy(true);
    let n = 0;
    for (const l of chosen.filter(canPick)) { try { const r = await pick.mutateAsync({ slug: l.slug, pick: true }); if (r.ok) n++; } catch { /* reported below */ } }
    setBusy(false); setSelected(new Set());
    toast({ kind: n ? 'ok' : 'error', text: n ? `Picked ${n}` : 'Nothing was picked' });
  };
  const buildSelected = async () => {
    const list = chosen.filter((l) => !l.buildState || l.buildState === 'failed');
    if (!list.length) { toast({ kind: 'info', text: 'Every selected business already has a build.' }); return; }
    setBusy(true);
    const r = await guard(`Building ${list.length === 1 ? list[0].name : `${list.length} businesses`}`, async (override) => {
      for (const l of list) await start.mutateAsync({ slug: l.slug, override });
      return list.length;
    });
    setBusy(false);
    if (r) { setSelected(new Set()); toast({ kind: 'ok', text: `Queued ${r} ${r === 1 ? 'build' : 'builds'}. They run one at a time.`, link: { to: '/activity', label: 'See activity' } }); }
  };

  const toggleSel = (slug: string) => setSelected((s) => { const n = new Set(s); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });
  const allShown = shown.length > 0 && shown.every((l) => selected.has(l.slug));

  return (
    <Page title="Leads" subtitle="Every business found, scored. Pick the ones worth building.">
      <FindPanel />
      <div className="glass mb-4 flex flex-wrap items-center gap-2 rounded-panel p-3">
        <div role="group" aria-label="Tier" className="flex items-center gap-1">
          <span className="px-1 text-xs text-fg-3">Tier</span>
          {TIERS.map((t) => (
            <button key={t} type="button" aria-pressed={tiers.includes(t)} onClick={() => toggleTier(t)} title={TIER_HINT[t]}
              className={cn('inline-flex h-(--row-h) items-center gap-1.5 rounded-full border px-3 text-sm transition-colors', tiers.includes(t) ? 'border-white/15 bg-white/12 text-fg' : 'border-transparent text-fg-3 hover:text-fg-2')}>
              <TierMark tier={t} />
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="f-cat">Category</label>
        <select id="f-cat" className="field w-auto min-w-36" value={filters.category ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {meta.data?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-area">Area</label>
        <select id="f-area" className="field w-auto min-w-32" value={filters.area ?? ''} onChange={(e) => set('area', e.target.value)}>
          <option value="">All areas</option>
          {meta.data?.areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-status">Status</label>
        <select id="f-status" className="field w-auto min-w-32" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as PipelineStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-q">Filter by text</label>
        <input id="f-q" className="field min-w-40 flex-1" placeholder="Filter by name or hook" defaultValue={filters.q ?? ''}
          onKeyDown={(e) => { if (e.key === 'Enter') set('q', (e.target as HTMLInputElement).value.trim()); }}
          onBlur={(e) => { if (e.target.value.trim() !== (filters.q ?? '')) set('q', e.target.value.trim()); }} />
      </div>

      {chosen.length ? (
        <div className="glass-strong sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-full px-4 py-2" role="region" aria-label="Selection">
          <span className="text-sm text-fg">{chosen.length} selected</span>
          <Button size="sm" variant="secondary" loading={busy} disabled={!chosen.some(canPick)} onClick={() => void pickSelected()}>Pick selected</Button>
          <Button size="sm" variant="primary" loading={busy} onClick={() => void buildSelected()}>Build selected</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      ) : null}

      {leads.error ? <ErrorState error={leads.error} what="leads" /> : !leads.data ? <SkeletonRows rows={8} /> : !rows.length ? (
        <Section><Empty icon={Search}>No leads match these filters. Widen the tiers, or search for a new trade and area above.</Empty></Section>
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-3">{rows.length} {rows.length === 1 ? 'lead' : 'leads'}</p>
          <Section className="hidden md:block" bodyClassName="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-3">
                <tr className="border-b border-border-soft">
                  <th scope="col" className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={() => setSelected(allShown ? new Set() : new Set(shown.map((l) => l.slug)))} /></th>
                  <SortHeader k="name" label="Business" sort={sort} setSort={setSort} />
                  <SortHeader k="score" label="Tier · score" sort={sort} setSort={setSort} />
                  <th scope="col" className="px-3 py-2 font-normal">Website</th>
                  <SortHeader k="reviews" label="Reviews" sort={sort} setSort={setSort} />
                  <th scope="col" className="px-3 py-2 font-normal">Channel</th>
                  <th scope="col" className="px-3 py-2 font-normal">Status</th>
                  <th scope="col" className="px-3 py-2 font-normal"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {shown.map((l) => (
                  <tr key={l.slug} className={cn('hover:bg-white/[0.025]', selected.has(l.slug) && 'bg-white/[0.04]')}>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.slug)} onChange={() => toggleSel(l.slug)} /></td>
                    <td className="max-w-[320px] px-3 py-2.5">
                      <Link to={`/b/${encodeURIComponent(l.slug)}/overview`} className="font-medium text-fg hover:underline">{l.name}</Link>
                      <div className="truncate text-xs text-fg-3">{l.categoryLabel} · {l.area}{l.hook ? ` · ${l.hook}` : ''}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><TierMark tier={l.tier} /> <span className="ml-1 text-fg-2">{l.score ?? '—'}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-fg-2">{l.websiteStatus ? SITE_STATUS_LABEL[l.websiteStatus] ?? l.websiteStatus : '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-fg-2">{l.rating !== null ? `${l.rating.toFixed(1)} · ${l.reviews}` : l.reviews}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-fg-2">{l.channel ? CHANNEL_LABEL[l.channel] ?? l.channel : '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StageChip l={l} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canPick(l) ? <Button size="sm" variant="secondary" onClick={() => togglePick(l, true)}>Pick</Button>
                        : canUnpick(l) ? <Button size="sm" variant="ghost" onClick={() => togglePick(l, false)}>Unpick</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((l) => (
              <li key={l.slug} className="glass rounded-card p-4">
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" aria-label={`Select ${l.name}`} checked={selected.has(l.slug)} onChange={() => toggleSel(l.slug)} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/b/${encodeURIComponent(l.slug)}/overview`} className="font-medium text-fg">{l.name}</Link>
                    <p className="text-xs text-fg-3">{l.categoryLabel} · {l.area}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <TierMark tier={l.tier} /><span className="text-xs text-fg-2">{l.score ?? '—'}</span>
                      <StageChip l={l} />
                    </div>
                    {l.hook ? <p className="mt-2 text-sm text-fg-2">{l.hook}</p> : null}
                  </div>
                  {canPick(l) ? <Button size="sm" variant="secondary" onClick={() => togglePick(l, true)}>Pick</Button>
                    : canUnpick(l) ? <Button size="sm" variant="ghost" onClick={() => togglePick(l, false)}>Unpick</Button> : null}
                </div>
              </li>
            ))}
          </ul>
          {rows.length > limit ? <div className="mt-4 flex justify-center"><Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</Button></div> : null}
        </>
      )}
    </Page>
  );
}
