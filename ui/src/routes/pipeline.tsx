import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Board, BoardCard, BoardColumn } from '../../../src/ui/api-types';
import { api, useBoard, useMeta, useMoveCard } from '../api';
import { useAgentGuard } from '../components/agent-guard';
import { Button } from '../components/ui/button';
import { Confirm } from '../components/ui/dialog';
import { Page } from '../components/ui/section';
import { Segmented } from '../components/ui/segmented';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { useToast } from '../components/ui/toast';
import { COLUMN_LABEL, plural } from '../lib/format';
import { BoardCardView, BoardColumnView } from './pipeline-card';
import { bizPath } from '../lib/links';

const COLUMNS: BoardColumn[] = ['picked', 'building', 'preview', 'ready', 'sent', 'replied', 'won', 'closed'];
const EMPTY_TEXT: Record<BoardColumn, string> = {
  picked: 'Pick leads from the Leads page.', building: 'Nothing building.', preview: 'No previews waiting.', ready: 'Nothing approved yet.',
  sent: 'No pitches out.', replied: 'No replies yet.', won: 'No wins yet.', closed: 'Nothing closed.',
};

/** Filter cards by the URL's text, category, tier and area. Pure, for testing. */
export function filterBoard(board: Board, f: { q: string; category: string; tier: string; area: string }, categoryLabel: (key: string) => string): Board {
  const q = f.q.trim().toLowerCase();
  const cat = f.category ? categoryLabel(f.category) : '';
  const keep = (c: BoardCard) => (!q || `${c.name} ${c.area} ${c.categoryLabel}`.toLowerCase().includes(q))
    && (!cat || c.categoryLabel === cat) && (!f.tier || c.tier === f.tier) && (!f.area || c.area === f.area);
  return { ...board, columns: Object.fromEntries(COLUMNS.map((k) => [k, (board.columns[k] ?? []).filter(keep)])) as Board['columns'] };
}

/** Move a card between columns in cached board data, for the optimistic update. */
function moveInBoard(board: Board, slug: string, from: BoardColumn, to: BoardColumn): Board {
  const card = board.columns[from].find((c) => c.slug === slug);
  if (!card) return board;
  return { ...board, columns: { ...board.columns, [from]: board.columns[from].filter((c) => c.slug !== slug), [to]: [{ ...card, since: new Date().toISOString(), moves: [] }, ...board.columns[to]] } };
}

export function PipelinePage() {
  const board = useBoard();
  const meta = useMeta();
  const move = useMoveCard();
  const guard = useAgentGuard();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [active, setActive] = useState<{ card: BoardCard; column: BoardColumn } | null>(null);
  const [closing, setClosing] = useState<{ card: BoardCard; from: BoardColumn } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [phoneColumn, setPhoneColumn] = useState<BoardColumn>('picked');

  const f = { q: params.get('q') ?? '', category: params.get('category') ?? '', tier: params.get('tier') ?? '', area: params.get('area') ?? '' };
  const setF = (k: keyof typeof f, v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const categoryLabel = useCallback((key: string) => meta.data?.categories.find((c) => c.key === key)?.label ?? key, [meta.data]);
  const data = useMemo(() => (board.data ? filterBoard(board.data, f, categoryLabel) : null), [board.data, f.q, f.category, f.tier, f.area, categoryLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = !!(f.q || f.category || f.tier || f.area);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const plainMove = useCallback(async (card: BoardCard, from: BoardColumn, to: BoardColumn, note?: string) => {
    const prev = qc.getQueryData<Board>(['board']);
    await qc.cancelQueries({ queryKey: ['board'] });
    if (prev) qc.setQueryData<Board>(['board'], moveInBoard(prev, card.slug, from, to));
    try {
      const r = await move.mutateAsync({ slug: card.slug, to, note });
      if (!r.ok) throw new Error(r.message);
      const fresh = await qc.fetchQuery<Board>({ queryKey: ['board'], queryFn: () => api.get('/api/board') });
      const now = fresh.columns[to]?.find((c) => c.slug === card.slug);
      toast({
        kind: 'ok', text: `${card.name} moved to ${COLUMN_LABEL[to]}.`,
        action: now?.moves.includes(from) ? { label: 'Undo', onClick: () => { void move.mutateAsync({ slug: card.slug, to: from }).catch((e: Error) => toast({ kind: 'error', text: `Undo failed: ${e.message}` })); } } : undefined,
      });
    } catch (e) {
      if (prev) qc.setQueryData(['board'], prev);
      toast({ kind: 'error', text: `Couldn't move ${card.name}: ${(e as Error).message}` });
    }
  }, [qc, move, toast]);

  const onMove = useCallback((card: BoardCard, from: BoardColumn, to: BoardColumn) => {
    if (!card.moves.includes(to) || from === to) return;
    if (to === 'sent') { navigate(bizPath(card.slug, 'deliver')); return; }
    if (to === 'closed') { setClosing({ card, from }); return; }
    if (to === 'building') {
      void guard(`Build ${card.name}`, (override) => move.mutateAsync({ slug: card.slug, to, override })).then((r) => {
        if (r?.ok) toast({ kind: 'ok', text: `Build started for ${card.name}.`, link: { to: bizPath(card.slug, 'progress'), label: 'Watch progress' } });
        else if (r) toast({ kind: 'error', text: r.message });
      });
      return;
    }
    void plainMove(card, from, to);
  }, [navigate, guard, move, toast, plainMove]);

  const onDragStart = (e: DragStartEvent) => setActive(e.active.data.current as { card: BoardCard; column: BoardColumn });
  const onDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as { card: BoardCard; column: BoardColumn } | undefined;
    setActive(null);
    if (a && e.over) onMove(a.card, a.column, e.over.id as BoardColumn);
  };

  const nameOf = (id: string | number) => (active?.card.slug === id ? active.card.name : String(id));
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${nameOf(a.id)}. It can move to ${active?.card.moves.map((m) => COLUMN_LABEL[m]).join(', ') || 'nowhere'}.`,
    onDragOver: ({ active: a, over }) => (over ? `${nameOf(a.id)} is over ${COLUMN_LABEL[over.id as BoardColumn]}.` : `${nameOf(a.id)} is not over a column it can move to.`),
    onDragEnd: ({ active: a, over }) => (over ? `${nameOf(a.id)} dropped on ${COLUMN_LABEL[over.id as BoardColumn]}.` : `${nameOf(a.id)} put back.`),
    onDragCancel: ({ active: a }) => `Moving ${nameOf(a.id)} was cancelled.`,
  };

  const counts = Object.fromEntries(COLUMNS.map((c) => [c, data?.columns[c]?.length ?? 0])) as Record<BoardColumn, number>;
  const renderColumn = (col: BoardColumn, phone = false) => {
    const cards = data?.columns[col] ?? [];
    const collapsed = !phone && col === 'closed' && !showClosed;
    return (
      <BoardColumnView key={col} column={col} count={cards.length} dragging={!!active} valid={!!active && active.column !== col && active.card.moves.includes(col)}
        collapsed={collapsed} onToggle={!phone && col === 'closed' ? () => setShowClosed((s) => !s) : undefined} className={phone ? 'w-full' : 'w-[272px]'}>
        {cards.length ? cards.map((c) => <BoardCardView key={c.slug} card={c} column={col} onMove={onMove} />)
          : <p className="px-2 py-6 text-center text-xs text-fg-3">{filtered ? 'No matches.' : EMPTY_TEXT[col]}</p>}
      </BoardColumnView>
    );
  };

  return (
    <Page wide title="Pipeline"
      subtitle={board.data ? <>{plural(COLUMNS.filter((c) => c !== 'closed').reduce((n, c) => n + (board.data!.columns[c]?.length ?? 0), 0), 'active business', 'active businesses')} · <Link to="/leads" className="underline underline-offset-2 hover:text-fg">{board.data.newLeads.toLocaleString('en-GB')} new leads</Link></> : null}>
      <div role="search" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="board-q">Search the board</label>
        <input id="board-q" className="field max-w-60" placeholder="Search" value={f.q} onChange={(e) => setF('q', e.target.value)} />
        <label className="sr-only" htmlFor="board-cat">Category</label>
        <select id="board-cat" className="field w-auto" value={f.category} onChange={(e) => setF('category', e.target.value)}>
          <option value="">All categories</option>
          {meta.data?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="board-tier">Tier</label>
        <select id="board-tier" className="field w-auto" value={f.tier} onChange={(e) => setF('tier', e.target.value)}>
          <option value="">All tiers</option>{['A', 'B', 'C', 'X'].map((t) => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <label className="sr-only" htmlFor="board-area">Area</label>
        <select id="board-area" className="field w-auto" value={f.area} onChange={(e) => setF('area', e.target.value)}>
          <option value="">All areas</option>{meta.data?.areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {filtered ? <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}><X className="size-3.5" aria-hidden />Clear</Button> : null}
      </div>

      {board.error ? <ErrorState error={board.error} what="the board" /> : !data ? (
        <div className="flex gap-3 overflow-hidden" role="status" aria-label="Loading">{COLUMNS.slice(0, 5).map((c) => <Skeleton key={c} className="h-96 w-[272px] shrink-0 rounded-panel" />)}</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)} accessibility={{ announcements }}>
          <div className="md:hidden">
            <div className="mb-3 overflow-x-auto pb-1">
              <Segmented size="sm" label="Column" value={phoneColumn} onChange={setPhoneColumn} options={COLUMNS.map((c) => ({ value: c, label: COLUMN_LABEL[c], count: counts[c] }))} />
            </div>
            {renderColumn(phoneColumn, true)}
          </div>
          <div className="hidden items-start gap-3 overflow-x-auto pb-4 md:flex">{COLUMNS.map((c) => renderColumn(c))}</div>
          <DragOverlay dropAnimation={null}>{active ? <div className="w-[256px]"><BoardCardView card={active.card} column={active.column} onMove={onMove} overlay /></div> : null}</DragOverlay>
        </DndContext>
      )}

      <Confirm open={!!closing} onClose={() => setClosing(null)} confirmLabel="Close" busy={move.isPending}
        title={closing ? `Close ${closing.card.name}?` : ''}
        onConfirm={() => { if (closing) { const c = closing; setClosing(null); void plainMove(c.card, c.from, 'closed', 'closed from the board'); } }}>
        They're marked lost and added to the suppression list, so they won't be contacted again.
      </Confirm>
    </Page>
  );
}
