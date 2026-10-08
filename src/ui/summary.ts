/** The Inbox, the discovery strip and the pipeline board, computed from the database and the site folders. */
import { join } from 'node:path';
import { openDb } from '../db/index.js';
import { listBuilds, type BuildRow } from '../build/queries.js';
import { readDelivery } from '../delivery/index.js';
import type { Board, BoardCard, BoardColumn, BuildState, Discovery, InboxItem, PipelineStatus, Summary, Tier } from './api-types.js';
import { activeJobFor, activeJobs, listJobs } from './jobs.js';
import { categoryLabel, siteDir, toBuildSummary } from './mappers.js';
import { fileUrl } from './files.js';
import { sentRounds } from './feedback.js';
import { getUsage } from './usage-cache.js';
import { listPhotos } from '../build/checkpoints.js';
import { dueFollowUps } from '../outreach/index.js';

const d = () => openDb();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

interface ActiveRow { slug: string; name: string; area: string; category_key: string; status: PipelineStatus; updated_at: string; tier: Tier | null; total: number | null; match_confidence: string | null }

function activeLeads(): ActiveRow[] {
  return d().prepare(`SELECT l.slug, l.name, l.area, l.category_key, p.status, p.updated_at, s.tier, s.total, c.match_confidence
    FROM leads l JOIN pipeline p ON p.lead_id = l.id LEFT JOIN scores s ON s.lead_id = l.id LEFT JOIN companies_house c ON c.lead_id = l.id
    WHERE p.status != 'new' ORDER BY p.updated_at DESC`).all() as unknown as ActiveRow[];
}
const buildsBySlug = () => new Map(listBuilds().map((b) => [b.slug, b]));

/** Which column a business is in. Pure. */
export function columnFor(status: PipelineStatus, state: BuildState | null): BoardColumn {
  if (status === 'lost' || status === 'do_not_contact') return 'closed';
  if (status === 'won') return 'won';
  if (status === 'replied') return 'replied';
  if (status === 'contacted' || status === 'followup_1' || status === 'followup_2') return 'sent';
  if (state === 'approved') return 'ready';
  if (status === 'preview_ready') return 'preview';
  if (status === 'building') return 'building';
  if (status === 'shortlisted' && state && !['picked', 'torn_down'].includes(state)) return 'building';
  return 'picked';
}

/** Where a card may be moved from a column. Pure. */
export function movesFor(col: BoardColumn, state: BuildState | null): BoardColumn[] {
  switch (col) {
    case 'picked': return ['building', 'closed'];
    case 'building': return ['closed'];
    case 'preview': return state === 'preview_ready' ? ['ready', 'closed'] : ['closed'];
    case 'ready': return ['sent', 'preview', 'closed'];
    case 'sent': return ['replied', 'won', 'closed'];
    case 'replied': return ['won', 'sent', 'closed'];
    case 'won': return ['replied', 'closed'];
    case 'closed': return [];
  }
}

function badgeFor(status: PipelineStatus, b: BuildRow | undefined, ltd: boolean): BoardCard['badge'] {
  const s = b?.state;
  if (s === 'failed') return { text: `Failed at ${b?.failed_step ?? 'a step'}`, tone: 'bad' };
  if (s === 'awaiting_photos' || s === 'awaiting_concept') return { text: s === 'awaiting_photos' ? 'Sort the photos' : 'Choose a concept', tone: 'warn' };
  if (s === 'revising') return { text: 'Revising', tone: 'info' };
  if (status === 'followup_1') return { text: 'Followed up', tone: 'info' };
  if (status === 'followup_2') return { text: 'Followed up twice', tone: 'info' };
  if (s === 'approved' && status === 'preview_ready' && !ltd) return { text: 'No cold email', tone: 'info' };
  return null;
}

export function board(): Board {
  const builds = buildsBySlug();
  const columns: Record<BoardColumn, BoardCard[]> = { picked: [], building: [], preview: [], ready: [], sent: [], replied: [], won: [], closed: [] };
  for (const r of activeLeads()) {
    const b = builds.get(r.slug);
    const state = (b?.state as BuildState | undefined) ?? null;
    const col = columnFor(r.status, state);
    if (col === 'closed' && columns.closed.length >= 60) continue;
    columns[col].push({
      slug: r.slug, name: r.name, area: r.area, categoryLabel: categoryLabel(r.category_key), tier: r.tier, score: r.total,
      status: r.status, buildState: state, heroShotUrl: fileUrl('site', r.slug, join(siteDir(r.slug), 'acta', 'qa', 'hero-mobile.png')),
      since: b && b.updated_at > r.updated_at && col !== 'sent' && col !== 'replied' ? b.updated_at : r.updated_at,
      badge: badgeFor(r.status, b, r.match_confidence === 'high'),
      moves: movesFor(col, state),
    });
  }
  const newLeads = (d().prepare("SELECT COUNT(*) n FROM pipeline WHERE status = 'new'").get() as { n: number }).n;
  return { columns, newLeads };
}

function inbox(): InboxItem[] {
  const items: InboxItem[] = [];
  const statuses = new Map((d().prepare('SELECT l.slug, p.status, p.updated_at FROM leads l JOIN pipeline p ON p.lead_id = l.id').all() as { slug: string; status: PipelineStatus; updated_at: string }[]).map((r) => [r.slug, r]));
  for (const b of listBuilds()) {
    const st = statuses.get(b.slug);
    if (!st || st.status === 'lost' || st.status === 'do_not_contact' || st.status === 'won') continue;
    if (activeJobFor(b.slug) !== null && b.state !== 'awaiting_photos' && b.state !== 'awaiting_concept') continue;
    const base = { slug: b.slug, name: b.name, at: b.updated_at };
    if (b.state === 'failed') items.push({ ...base, kind: 'failed', tab: 'progress', detail: `Failed at ${b.failed_step ?? 'a step'}: ${(b.last_error ?? '').replace(/\s+/g, ' ').slice(0, 120)}` });
    else if (b.state === 'awaiting_photos') {
      let n = 0; try { n = listPhotos(b.repo_dir ?? siteDir(b.slug)).length; } catch { /* unknown */ }
      items.push({ ...base, kind: 'photos', tab: 'photos', detail: n ? `${n} photos to sort before design starts` : 'Photos to sort before design starts' });
    } else if (b.state === 'awaiting_concept') items.push({ ...base, kind: 'concept', tab: 'concepts', detail: 'Three concepts ready. Choose one before the build continues.' });
    else if (b.state === 'preview_ready') { const r = sentRounds(b.slug); items.push({ ...base, kind: 'review', tab: 'review', detail: r ? `Revision ${r} ready to check` : 'First preview ready to review' }); }
    else if (b.state === 'approved' && st.status === 'preview_ready') {
      const del = readDelivery(b.slug);
      if (!del?.sentAt) items.push({ ...base, kind: 'send', tab: 'deliver', detail: del ? (del.emailAllowed ? 'Approved. Cold email allowed.' : 'Approved. No cold email: phone, walk in or WhatsApp.') : 'Approved. Generate the package and send it.' });
    }
  }
  for (const [slug, st] of statuses) {
    if (st.status !== 'replied') continue;
    const name = (d().prepare('SELECT name FROM leads WHERE slug = ?').get(slug) as { name: string }).name;
    items.push({ slug, name, at: st.updated_at, kind: 'reply', tab: 'overview', detail: 'They replied. Log the outcome: won, lost or follow up.' });
  }
  try {
    for (const f of dueFollowUps()) items.push({ slug: f.slug, name: f.name, at: f.dueAt, kind: 'followup', tab: 'deliver', detail: `${f.last ? 'Last follow-up' : `Follow-up ${f.n}`} due · ${f.channel === 'email' ? 'email' : f.channel.replace('_', ' ')}` });
  } catch { /* outreach not set up yet */ }
  const order = ['failed', 'photos', 'concept', 'review', 'send', 'followup', 'reply'];
  return items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.at < b.at ? -1 : 1));
}

/** The next Sunday at 22:00 local time, matching the launchd job in src/loop/schedule.ts. */
export function nextSunday22(now = new Date()): Date {
  const t = new Date(now);
  t.setHours(22, 0, 0, 0);
  const add = (7 - t.getDay()) % 7;
  t.setDate(t.getDate() + add);
  if (t <= now) t.setDate(t.getDate() + 7);
  return t;
}

export function discovery(): Discovery {
  const lastSearch = (d().prepare('SELECT MAX(last_run_at) t FROM searches').get() as { t: string | null }).t;
  const lastRun = (d().prepare('SELECT MAX(started_at) t FROM runs').get() as { t: string | null }).t;
  const lastRunAt = [lastSearch, lastRun].filter(Boolean).sort().pop() ?? null;
  const week = daysAgo(7);
  const nw = d().prepare(`SELECT COUNT(*) total, SUM(CASE WHEN s.tier IN ('A','B') THEN 1 ELSE 0 END) ab FROM leads l LEFT JOIN scores s ON s.lead_id = l.id WHERE l.discovered_at >= ?`).get(week) as { total: number; ab: number | null };
  const recent = d().prepare(`SELECT query, MAX(started_at) at FROM runs WHERE query IS NOT NULL GROUP BY query ORDER BY at DESC LIMIT 6`).all() as { query: string; at: string }[];
  const recentSearches = recent.map((r) => {
    const c = d().prepare(`SELECT COUNT(*) found, SUM(CASE WHEN s.tier IN ('A','B') THEN 1 ELSE 0 END) ab FROM leads l LEFT JOIN scores s ON s.lead_id = l.id WHERE l.source_query = ?`).get(r.query) as { found: number; ab: number | null };
    return { query: r.query, lastRunAt: r.at, found: c.found, tierAB: c.ab ?? 0 };
  });
  return { lastRunAt, newThisWeek: { total: nw.total, tierAB: nw.ab ?? 0 }, recentSearches };
}

export async function summary(): Promise<Summary> {
  const b = board();
  const counts = Object.fromEntries(Object.entries(b.columns).map(([k, v]) => [k, v.length])) as Summary['counts'];
  counts.newLeads = b.newLeads;
  const builds = buildsBySlug();
  const running = activeJobs().map((j) => {
    const slug = j.kind === 'search' ? null : j.target;
    const br = slug ? builds.get(slug) : undefined;
    const step = br ? toBuildSummary(br, j.id, 0).rail.find((r) => r.status === 'current')?.label ?? null : null;
    return { ...j, slug, step };
  });
  const events = d().prepare(`SELECT e.at, l.slug, l.name, e.level, e.message FROM build_events e JOIN leads l ON l.id = e.lead_id
    WHERE e.level != 'info' OR e.message LIKE 'paused:%' OR e.message LIKE 'live at%' OR e.message LIKE 'starting at%' ORDER BY e.id DESC LIMIT 12`).all() as { at: string; slug: string; name: string; level: string; message: string }[];
  const jobs = listJobs(12).filter((j) => j.endedAt).map((j) => ({ at: j.endedAt!, slug: j.kind === 'search' ? null : j.target, name: null as string | null, level: j.status === 'failed' ? 'error' : 'info', message: `${j.label}: ${j.status}` }));
  const recent = [...events, ...jobs].sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 12);
  return { needsYou: inbox(), counts, running, recent, discovery: discovery(), usage: await getUsage() };
}
