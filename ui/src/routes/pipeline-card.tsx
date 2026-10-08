import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { BoardCard, BoardColumn } from '../../../src/ui/api-types';
import { Dot, TierMark } from '../components/ui/chip';
import { Menu } from '../components/ui/menu';
import { cn } from '../lib/cn';
import { age, COLUMN_LABEL } from '../lib/format';

/** One business on the board. Pointer drag from anywhere on the card; keyboard drag from the grip; "Move to" menu for everything. */
export function BoardCardView({ card, column, onMove, overlay }: { card: BoardCard; column: BoardColumn; onMove: (card: BoardCard, from: BoardColumn, to: BoardColumn) => void; overlay?: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: card.slug, data: { card, column }, disabled: overlay || card.moves.length === 0 });
  const items = useMemo(() => card.moves.map((to) => ({ label: COLUMN_LABEL[to], onSelect: () => onMove(card, column, to) })), [card, column, onMove]);
  return (
    <article ref={overlay ? undefined : setNodeRef} onPointerDown={overlay ? undefined : (listeners?.onPointerDown as React.PointerEventHandler<HTMLElement> | undefined)}
      className={cn('glass group relative rounded-card p-3 transition-opacity', isDragging && 'opacity-30', overlay && 'glass-lit rotate-[1.5deg] shadow-2xl')}>
      {card.heroShotUrl ? (
        <div className="mb-2.5 h-24 overflow-hidden rounded-[14px] border border-border-soft bg-white/5">
          <img src={card.heroShotUrl} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover object-top" />
        </div>
      ) : null}
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-snug font-medium">
            <Link to={`/b/${encodeURIComponent(card.slug)}`} draggable={false} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-fg">{card.name}</Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-fg-3">{card.categoryLabel} · {card.area}</p>
        </div>
        {!overlay && card.moves.length ? (
          <div className="relative z-10 flex shrink-0 items-center opacity-70 group-hover:opacity-100 focus-within:opacity-100">
            <button type="button" {...attributes} onKeyDown={listeners?.onKeyDown as React.KeyboardEventHandler<HTMLButtonElement> | undefined} aria-label={`Drag ${card.name}`} aria-roledescription="draggable card"
              className="grid size-7 cursor-grab place-items-center rounded-full text-fg-3 hover:bg-white/10 hover:text-fg"><GripVertical className="size-3.5" aria-hidden /></button>
            <Menu label={`Move ${card.name} to`} items={items} trigger={({ open, toggle, id }) => (
              <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`Move ${card.name} to`}
                className="grid size-7 place-items-center rounded-full text-fg-3 hover:bg-white/10 hover:text-fg"><MoreHorizontal className="size-4" aria-hidden /></button>
            )} />
          </div>
        ) : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-fg-3">
        <TierMark tier={card.tier} />
        {card.since ? <span title="Time in this column">{age(card.since)}</span> : null}
        {card.badge ? <span className="inline-flex items-center gap-1.5 text-fg-2"><Dot tone={card.badge.tone} />{card.badge.text}</span> : null}
      </div>
    </article>
  );
}

/** A board column. It's a drop target only for the card being dragged when the move is allowed. */
export function BoardColumnView({ column, count, dragging, valid, collapsed, onToggle, children, className }: {
  column: BoardColumn; count: number; dragging: boolean; valid: boolean; collapsed?: boolean; onToggle?: () => void; children: ReactNode; className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column, disabled: !valid });
  const ring = dragging ? (valid ? (isOver ? 'ring-2 ring-fg/60' : 'ring-1 ring-fg/25') : 'opacity-35') : '';
  if (collapsed) {
    return (
      <section ref={setNodeRef} aria-label={`${COLUMN_LABEL[column]}, ${count}`} className={cn('glass flex w-14 shrink-0 flex-col items-center gap-3 rounded-panel py-4 transition', ring, className)}>
        <button type="button" onClick={onToggle} aria-expanded={false} aria-label={`Show ${COLUMN_LABEL[column]}`} className="grid size-8 place-items-center rounded-full text-fg-3 hover:bg-white/10 hover:text-fg"><ChevronLeft className="size-4" aria-hidden /></button>
        <span className="num-display text-xl">{count}</span>
        <span className="text-sm text-fg-3 [writing-mode:vertical-rl]">{COLUMN_LABEL[column]}</span>
      </section>
    );
  }
  return (
    <section ref={setNodeRef} aria-label={`${COLUMN_LABEL[column]}, ${count}`} className={cn('flex min-h-0 shrink-0 flex-col rounded-panel bg-white/[0.018] p-2 transition', ring, className)}>
      <header className="flex items-center justify-between gap-2 px-2 pt-1 pb-2.5">
        <h2 className="text-sm font-normal text-fg-2">{COLUMN_LABEL[column]}</h2>
        <div className="flex items-center gap-1">
          <span className="num-display text-xl">{count}</span>
          {onToggle ? <button type="button" onClick={onToggle} aria-expanded aria-label={`Hide ${COLUMN_LABEL[column]}`} className="grid size-7 place-items-center rounded-full text-fg-3 hover:bg-white/10 hover:text-fg"><ChevronRight className="size-4" aria-hidden /></button> : null}
        </div>
      </header>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </section>
  );
}
