import { ArrowDown, ArrowUp, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { LeadSummary, PipelineStatus, Suggestion } from '../../../src/ui/api-types';
import { useAutoFind, useFinding, useFindNow, useLeads, useMeta, usePick, useSearch, useStartBuild, useSuggestions, useSummary, type LeadFilters } from '../api';
import { useAgentGuard } from '../components/agent-guard';
import { EMAIL_OPTIONS, EmailChip, REACH_OPTIONS, ReachChip, ReachLine, useReachGate } from '../components/reach';
import { ContentChip } from '../components/content';
import { GatesCell, VERDICT_OPTIONS, VerdictChip } from '../components/qualify';
import { Button } from '../components/ui/button';
import { Chip, Dot, TierMark, type DotTone } from '../components/ui/chip';
import { Empty } from '../components/ui/empty';
import { Page, Section } from '../components/ui/section';
import { SkeletonRows } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/cn';
import { SITE_STATUS_LABEL, STATUS_LABEL, stageOf } from '../lib/format';

const TIERS = ['A', 'B', 'C', 'X'];
const PAGE = 200;
type SortKey = 'score' | 'grade' | 'name' | 'reviews' | 'rating' | 'content';

/** Filters live in the address, so a filtered list can be bookmarked. Tier defaults to A, B and C (everything but the excluded); "all" clears it. */
export function filtersFrom(p: URLSearchParams): LeadFilters {
  const t = p.get('tier');
  return {
    tier: t === 'all' ? undefined : (t ?? 'A,B,C').split(',').filter((x) => TIERS.includes(x)),
    category: p.get('category') || undefined,
    area: p.get('area') || undefined,
    status: p.get('status') || undefined,
    reach: p.get('reach') || undefined,
    email: p.get('email') || undefined,
    verdict: p.get('verdict') || undefined,
    q: p.get('q') || undefined,
  };
}

const canPick = (l: LeadSummary) => l.status === 'new';
const GROUPS: { key: LeadSummary['verdict']; title: string; hint: string; empty: string }[] = [
  { key: 'pass', title: 'Passes', hint: 'Needs a site, established, somewhere to send the preview, enough to build from. Best grade first', empty: 'Nothing passes these filters. The near misses below are one step away.' },
  { key: 'near', title: 'Near misses', hint: 'One gate short: the line under each says what', empty: 'No near misses.' },
  { key: 'fail', title: "Doesn't pass", hint: '', empty: 'None.' },
];
const GROUP_TONE: Record<LeadSummary['verdict'], DotTone> = { pass: 'ok', near: 'warn', fail: 'muted' };
/** The website, said so it helps the pitch: a live site is weak (worth replacing) or decent. */
const siteLabel = (l: LeadSummary) => !l.websiteStatus ? '—' : l.websiteStatus === 'live' ? ((l.opportunity ?? 0) >= 50 ? 'Weak site' : 'Decent site') : SITE_STATUS_LABEL[l.websiteStatus] ?? l.websiteStatus;
function StageChip({ l }: { l: LeadSummary }) { const st = stageOf(l.status, l.buildState); return <Chip dot={st.tone}>{st.label}</Chip>; }
/** Picking creates a queued build record, so a picked lead can be unpicked until its build actually starts. */
const canUnpick = (l: LeadSummary) => l.status === 'shortlisted' && (!l.buildState || l.buildState === 'picked');

const TIER_HINT: Record<string, string> = { A: 'Tier A: the best fit. No working site, strong reviews.', B: 'Tier B: a good fit.', C: 'Tier C: a weak fit.', X: 'Tier X: not worth pitching.' };

/** Find new businesses: the search, automatic finding with what it will search next, what's running, and what recent searches found. */
function FindPanel() {
  const [q, setQ] = useState('');
  const search = useSearch();
  const summary = useSummary();
  const finding = useFinding();
  const auto = useAutoFind();
  const now = useFindNow();
  const toast = useToast();
  const running = summary.data?.running.filter((j) => j.kind === 'search' || j.kind === 'leads') ?? [];
  const recent = summary.data?.discovery.recentSearches ?? [];
  const f = finding.data;
  const start = (query: string) => search.mutate(query, {
    onSuccess: () => { setQ(''); toast({ kind: 'ok', text: `Searching "${query}". New leads appear in the list when it finishes.` }); },
    onError: (err) => toast({ kind: 'error', text: `The search didn't start: ${err.message}` }),
  });
  const run = (e: React.FormEvent) => { e.preventDefault(); const query = q.trim(); if (query) start(query); };
  const toggle = () => f && auto.mutate(!f.on, {
    onSuccess: (r) => toast({ kind: 'ok', text: r.on ? 'Auto-find is on.' : 'Auto-find is off. Search by hand above.' }),
    onError: (err) => toast({ kind: 'error', text: err.message }),
  });
  const findNow = () => now.mutate(undefined, {
    onSuccess: () => toast({ kind: 'ok', text: `Finding leads: ${f?.next.length ?? 'the best'} searches, then audit and score. Suggestions update when it finishes.`, link: { to: '/activity', label: 'See activity' } }),
    onError: (err) => toast({ kind: 'error', text: `It didn't start: ${err.message}` }),
  });
  return (
    <section className="glass mb-4 rounded-panel p-4 md:p-5" aria-labelledby="find-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="find-h" className="text-sm font-medium">Find new businesses</h2>
          <p className="mt-0.5 text-xs text-fg-3">A trade and an area. Each result is checked for a website, matched with Companies House and scored.</p>
        </div>
        {f ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" aria-pressed={f.on} loading={auto.isPending} onClick={toggle} title="Search automatically every day, best searches first">
              <Dot tone={f.on ? 'ok' : 'muted'} />Auto-find {f.on ? 'on' : 'off'}
            </Button>
            <Button size="sm" variant="secondary" loading={now.isPending} disabled={running.some((j) => j.kind === 'leads')} onClick={findNow} title="Run the next batch of searches now">
              <Sparkles className="size-4" aria-hidden />Find now
            </Button>
          </div>
        ) : null}
      </div>
      <form role="search" onSubmit={run} className="mt-3 flex gap-2">
        <label htmlFor="lead-search" className="sr-only">Trade and area</label>
        <input id="lead-search" className="field flex-1" placeholder="e.g. barbers in Moseley, or cafes in Didsbury, Manchester" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="primary" loading={search.isPending} disabled={!q.trim()}><Search className="size-4" aria-hidden />Search</Button>
      </form>
      {running.map((j) => (
        <p key={j.id} className="mt-3 flex items-center gap-2 text-sm text-fg-2"><Dot tone="live" />{j.status === 'queued' ? 'Waiting' : j.kind === 'leads' ? 'Finding leads' : 'Searching'} {j.target ? `"${j.target}"` : ''}… <Link to={`/activity/${j.id}`} className="text-xs text-fg-3 underline underline-offset-2">details</Link></p>
      ))}
      {f ? (
        <div className="mt-4 border-t border-border-soft pt-3 text-xs leading-6 text-fg-3">
          <p>
            {f.on ? <>Auto-find runs {f.runsAt}: the {f.next.length} best of {f.possible} possible searches, {f.budget} Google requests.</> : <>Auto-find is off. Next time it would run these {f.next.length} of {f.possible} possible searches.</>}
            {f.on && !f.scheduled ? <> Not scheduled on this Mac yet: run <code className="rounded bg-white/5 px-1 text-fg-2">pnpm pipeline schedule install --jobs leads</code>, or use Find now.</> : null}
          </p>
          {f.next.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span>Next up:</span>
              {f.next.slice(0, 8).map((n) => (
                <button key={n.query} type="button" onClick={() => start(n.query)} title={`About ${n.per10} good leads per 10 found. ${n.why.join('. ')}. Click to search now.`}
                  className="inline-flex h-(--chip-h) items-center gap-1 rounded-full border border-border-soft bg-white/[0.04] px-2 text-xs text-fg-2 hover:bg-white/[0.08] hover:text-fg">
                  {n.query}<span className="text-fg-4">~{n.per10}</span>
                </button>
              ))}
            </div>
          ) : null}
          {f.bestTrades.length ? (
            <p className="mt-1.5">Best so far, good leads per 10 found: {f.bestTrades.map((t, i) => <span key={t.label}>{i ? ' · ' : ''}<span className="text-fg-2">{t.label}</span> {t.per10}</span>)}
              {f.bestAreas.length ? <> · in {f.bestAreas.map((a, i) => <span key={a.label}>{i ? ' · ' : ''}<span className="text-fg-2">{a.label}</span> {a.per10}</span>)}</> : null}
            </p>
          ) : null}
        </div>
      ) : null}
      {recent.length ? (
        <p className="mt-2 text-xs leading-6 text-fg-3">
          Recent: {recent.slice(0, 5).map((r, i) => <span key={r.query}>{i ? ' · ' : ''}<span className="text-fg-2">{r.query}</span> ({r.tierAB} good of {r.found})</span>)}
        </p>
      ) : null}
    </section>
  );
}

/** The leads that pass every gate, best grade first, then the near misses with what each is missing. Nothing is picked for you. */
function SuggestedPanel({ onPick }: { onPick: (s: Suggestion) => void }) {
  const list = useSuggestions();
  const [all, setAll] = useState(false);
  const rows = list.data ?? [];
  if (!rows.length) return null;
  // An older server sends suggestions without gates: show nothing rather than break the page.
  const passed = rows.filter((r) => r.qualify?.verdict === 'pass');
  const near = rows.filter((r) => r.qualify?.verdict === 'near');
  const fresh = passed.filter((r) => r.isNew).length;
  const card = (x: Suggestion) => {
    const failed = x.qualify.gates.filter((g) => !g.pass);
    return (
      <li key={x.slug} className="flex flex-col gap-2 rounded-card border border-border-soft bg-white/[0.02] p-3" title={x.reasons.join('\n')}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/b/${encodeURIComponent(x.slug)}/overview`} className="font-medium text-fg hover:underline">{x.name}</Link>
            <p className="truncate text-xs text-fg-3">{x.categoryLabel} · {x.area}</p>
          </div>
          {x.isNew ? <Chip dot="ok">New</Chip> : null}
        </div>
        {failed.length ? <p className="text-sm text-fg-2"><span className="text-fg">Missing {failed[0].label.toLowerCase()}:</span> {failed[0].detail}</p> : <p className="line-clamp-2 text-sm text-fg-2">{x.hook}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <VerdictChip verdict={x.qualify.verdict} grade={x.qualify.grade} missing={failed.map((g) => `${g.label}: ${g.detail}`).join('; ') || null} />
          <ContentChip content={x.content} />
          {x.reach.email ? <EmailChip reach={x.reach} websiteStatus="live" /> : null}
          <ReachChip reach={x.reach} />
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onPick(x)}>Pick</Button>
        </div>
      </li>
    );
  };
  const shownPassed = all ? passed : passed.slice(0, 6);
  const shownNear = all ? near : near.slice(0, 3);
  return (
    <Section className="mb-4" title={<h2 className="text-sm font-medium">Passed the gates{passed.length ? <span className="ml-2 text-xs font-normal text-fg-3">{passed.length}{fresh ? `, ${fresh} new this week` : ''}</span> : null}</h2>}
      actions={<span className="text-xs text-fg-3">Needs a site, established, somewhere to send the preview, enough to build from. Ranked by grade.</span>}>
      {passed.length ? <ul className="grid gap-2 p-3 md:grid-cols-2 lg:grid-cols-3">{shownPassed.map(card)}</ul>
        : <p className="px-5 py-3 text-sm text-fg-3">Nothing passes yet. The near misses below are one step away, most often an email to find.</p>}
      {near.length ? (
        <>
          <h3 className="px-5 pt-1 text-xs font-medium text-fg-3">Near misses, one gate short</h3>
          <ul className="grid gap-2 p-3 md:grid-cols-2 lg:grid-cols-3">{shownNear.map(card)}</ul>
        </>
      ) : null}
      {passed.length > 6 || near.length > 3 ? <div className="flex justify-center pb-3"><Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Button></div> : null}
    </Section>
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'grade', dir: -1 });
  const [busy, setBusy] = useState(false);
  const reachGate = useReachGate();

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
    const val = (l: LeadSummary) => (sort.key === 'name' ? l.name.toLowerCase() : sort.key === 'reviews' ? l.reviews : sort.key === 'rating' ? (l.rating ?? -1) : sort.key === 'content' ? l.content.score : sort.key === 'grade' ? ({ pass: 2000, near: 1000, fail: 0 }[l.verdict] + l.grade) : (l.score ?? -1));
    return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [leads.data, sort]);
  // Three tables: the leads that pass every gate, the near misses, and the rest (collapsed). An older server sends no gates: one table.
  const groups = useMemo(() => rows.every((r) => !!r.verdict)
    ? GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.verdict === g.key) }))
    : [{ key: 'all' as const, title: 'Leads', hint: '', empty: '', rows }], [rows]);
  const [showRest, setShowRest] = useState(false);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const chosen = [...selected].map((s) => bySlug.get(s)).filter((x): x is LeadSummary => !!x);

  const togglePick = (l: { slug: string; name: string }, on: boolean) => pick.mutate({ slug: l.slug, pick: on }, {
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
  const buildSelected = () => {
    const list = chosen.filter((l) => !l.buildState || l.buildState === 'failed');
    if (!list.length) { toast({ kind: 'info', text: 'Every selected business already has a build.' }); return; }
    reachGate.gate(list, () => void buildList(list));
  };
  const buildList = async (list: LeadSummary[]) => {
    setBusy(true);
    const r = await guard(`Building ${list.length === 1 ? list[0].name : `${list.length} businesses`}`, async (override) => {
      for (const l of list) await start.mutateAsync({ slug: l.slug, override });
      return list.length;
    });
    setBusy(false);
    if (r) { setSelected(new Set()); toast({ kind: 'ok', text: `Queued ${r} ${r === 1 ? 'build' : 'builds'}. They run one at a time.`, link: { to: '/activity', label: 'See activity' } }); }
  };

  const toggleSel = (slug: string) => setSelected((s) => { const n = new Set(s); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });

  return (
    <Page title="Leads" subtitle="Every business found, scored, with the best suggested first. Pick the ones worth building.">
      <FindPanel />
      <SuggestedPanel onPick={(x) => togglePick(x, true)} />
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
        <label className="sr-only" htmlFor="f-verdict">Gates</label>
        <select id="f-verdict" className="field w-auto min-w-40" value={filters.verdict ?? ''} onChange={(e) => set('verdict', e.target.value)} title="Whether it clears every gate in config/pick.yaml">
          {VERDICT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-reach">Reach</label>
        <select id="f-reach" className="field w-auto min-w-40" value={filters.reach ?? ''} onChange={(e) => set('reach', e.target.value)} title="How you could get the preview to them">
          {REACH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-email">Email</label>
        <select id="f-email" className="field w-auto min-w-36" value={filters.email ?? ''} onChange={(e) => set('email', e.target.value)} title="Whether there's an email address to send the preview to">
          {EMAIL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
          {groups.map((g) => {
            const open = g.key !== 'fail' || showRest;
            const shown = open ? (g.key === 'fail' ? g.rows.slice(0, limit) : g.rows) : [];
            const allShown = shown.length > 0 && shown.every((l) => selected.has(l.slug));
            return (
              <Section key={g.key} className="mb-4"
                title={<h2 className="flex items-center gap-2 text-sm font-medium">{g.key !== 'all' ? <Dot tone={GROUP_TONE[g.key]} /> : null}{g.title}<span className="text-xs font-normal text-fg-3">{g.rows.length}</span></h2>}
                actions={g.key === 'fail' ? <Button size="sm" variant="ghost" onClick={() => setShowRest((v) => !v)}>{showRest ? 'Hide' : `Show ${g.rows.length}`}</Button> : <span className="text-xs text-fg-3">{g.hint}</span>}
                bodyClassName={open ? 'overflow-x-auto' : 'hidden'}>
                {!g.rows.length ? <p className="px-5 py-4 text-sm text-fg-3">{g.empty}</p> : open ? (
                  <>
                    <table className="hidden w-full table-fixed text-sm lg:table">
                      {/* Fixed widths, so the three tables' columns line up under each other. */}
                      <colgroup><col className="w-10" /><col /><col className="w-40" /><col className="w-28" /><col className="w-24" /><col className="w-28" /><col className="w-52" /><col className="w-40" /></colgroup>
                      <thead className="text-left text-xs text-fg-3">
                        <tr className="border-b border-border-soft">
                          <th scope="col" className="w-10 px-3 py-2"><input type="checkbox" aria-label={`Select all in ${g.title}`} checked={allShown} onChange={() => setSelected((cur) => { const next = new Set(cur); for (const l of shown) { if (allShown) next.delete(l.slug); else next.add(l.slug); } return next; })} /></th>
                          <SortHeader k="name" label="Business" sort={sort} setSort={setSort} />
                          <SortHeader k="grade" label="Gates" sort={sort} setSort={setSort} />
                          <th scope="col" className="px-3 py-2 font-normal">Website</th>
                          <SortHeader k="reviews" label="Reviews" sort={sort} setSort={setSort} />
                          <SortHeader k="content" label="Content" sort={sort} setSort={setSort} />
                          <th scope="col" className="px-3 py-2 font-normal">Reach</th>
                          <th scope="col" className="px-3 py-2 font-normal"><span className="sr-only">Stage and pick</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((l) => (
                          <tr key={l.slug} className={cn('border-b border-border-soft last:border-0 hover:bg-white/[0.025]', selected.has(l.slug) && 'bg-white/[0.04]')}>
                            <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.slug)} onChange={() => toggleSel(l.slug)} /></td>
                            <td className="px-3 py-2.5" title={l.hook || undefined}>
                              <Link to={`/b/${encodeURIComponent(l.slug)}/overview`} className="block truncate font-medium text-fg hover:underline">{l.name}</Link>
                              <div className="truncate text-xs text-fg-3">{l.categoryLabel} · {l.area}</div>
                            </td>
                            <td className="px-3 py-2.5"><GatesCell verdict={l.verdict} grade={l.grade} gaps={l.gaps} missing={l.missing} /></td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-fg-2">{siteLabel(l)}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-fg-2" title={`${l.reviews} Google reviews`}>{l.rating !== null ? <>{l.rating.toFixed(1)} <span className="text-fg-3">· {l.reviews}</span></> : <span className="text-fg-3">{l.reviews}</span>}</td>
                            <td className="px-3 py-2.5"><ContentChip content={l.content} /></td>
                            <td className="px-3 py-2.5"><ReachLine reach={l.reach} /></td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-end gap-2">
                                {l.status !== 'new' || l.buildState ? <StageChip l={l} /> : null}
                                {canPick(l) ? <Button size="sm" variant="secondary" onClick={() => togglePick(l, true)}>Pick</Button>
                                  : canUnpick(l) ? <Button size="sm" variant="ghost" onClick={() => togglePick(l, false)}>Unpick</Button> : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ul className="flex flex-col gap-2 p-2 lg:hidden">
                      {shown.map((l) => (
                        <li key={l.slug} className="rounded-card border border-border-soft bg-white/[0.02] p-4">
                          <div className="flex items-start gap-3">
                            <input type="checkbox" className="mt-1" aria-label={`Select ${l.name}`} checked={selected.has(l.slug)} onChange={() => toggleSel(l.slug)} />
                            <div className="min-w-0 flex-1">
                              <Link to={`/b/${encodeURIComponent(l.slug)}/overview`} className="font-medium text-fg">{l.name}</Link>
                              <p className="text-xs text-fg-3">{l.categoryLabel} · {l.area}</p>
                              <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2">
                                <GatesCell verdict={l.verdict} grade={l.grade} gaps={l.gaps} missing={l.missing} />
                                <ReachLine reach={l.reach} />
                                <ContentChip content={l.content} />
                                {l.status !== 'new' || l.buildState ? <StageChip l={l} /> : null}
                              </div>
                              {l.hook ? <p className="mt-2 text-sm text-fg-2">{l.hook}</p> : null}
                            </div>
                            {canPick(l) ? <Button size="sm" variant="secondary" onClick={() => togglePick(l, true)}>Pick</Button>
                              : canUnpick(l) ? <Button size="sm" variant="ghost" onClick={() => togglePick(l, false)}>Unpick</Button> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {g.key === 'fail' && g.rows.length > limit ? <div className="flex justify-center py-3"><Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, g.rows.length - limit)} more</Button></div> : null}
                  </>
                ) : null}
              </Section>
            );
          })}
        </>
      )}
      {reachGate.dialog}
    </Page>
  );
}
