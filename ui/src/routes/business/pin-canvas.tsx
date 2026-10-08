import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';

/** A point inside a box, as 0-1 fractions of its width and height, clamped to the box. */
export function fractionFromPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export interface CanvasPin { id: number; n: number; x: number; y: number; text: string; draggable?: boolean; muted?: boolean }

/** The numbered pin mark. The only colour on the canvas. */
export function PinMark({ n, selected, muted, className }: { n: number; selected?: boolean; muted?: boolean; className?: string }) {
  return (
    <span className={cn('grid size-6 place-items-center rounded-full text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]',
      muted ? 'bg-white/30' : 'bg-pin', selected && 'ring-2 ring-white ring-offset-2 ring-offset-black/60', className)}>{n}</span>
  );
}

/**
 * A full-page screenshot with numbered pins at fractional positions. In comment mode a click drops a
 * draft pin with a small popover to write the comment. Saved pins can be dragged when `draggable`.
 */
export function PinCanvas({ src, alt, pins, selectedId, onSelect, commentMode, onCreate, onMove, maxWidth, readOnly }: {
  src: string;
  alt: string;
  pins: CanvasPin[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  commentMode?: boolean;
  onCreate?: (p: { x: number; y: number; text: string; rule: boolean }) => Promise<unknown> | void;
  onMove?: (id: number, x: number, y: number) => void;
  maxWidth?: number;
  readOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => { setDraft(null); }, [src]);
  useEffect(() => { if (!commentMode) setDraft(null); }, [commentMode]);

  const rect = () => box.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };

  const onImageClick = (e: React.MouseEvent) => {
    if (readOnly || !commentMode || drag) return;
    if ((e.target as HTMLElement).closest('[data-pin],[data-draft]')) return;
    setDraft(fractionFromPoint(e.clientX, e.clientY, rect()));
  };

  const pinDown = (e: ReactPointerEvent, p: CanvasPin) => {
    if (readOnly || !p.draggable || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: p.id, x: p.x, y: p.y, startX: e.clientX, startY: e.clientY, moved: false });
  };
  const pinMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3;
    if (!moved) return;
    const f = fractionFromPoint(e.clientX, e.clientY, rect());
    setDrag({ ...drag, ...f, moved: true });
  };
  const pinUp = (p: CanvasPin) => {
    if (!drag) return;
    if (drag.moved) onMove?.(p.id, drag.x, drag.y);
    else onSelect?.(p.id);
    setTimeout(() => setDrag(null), 0);
  };
  const pinKey = (e: ReactKeyboardEvent, p: CanvasPin) => {
    if (!p.draggable || readOnly || !onMove) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    onMove(p.id, Math.max(0, Math.min(1, p.x + m[0])), Math.max(0, Math.min(1, p.y + m[1])));
  };

  return (
    <div className="mx-auto w-full" style={maxWidth ? { maxWidth } : undefined}>
      <div ref={box} onClick={onImageClick} className={cn('relative select-none', commentMode && !readOnly ? 'cursor-crosshair' : '')} data-testid="pin-canvas">
        <img src={src} alt={alt} draggable={false} className="block h-auto w-full rounded-[14px]" />
        {pins.map((p) => {
          const live = drag?.id === p.id ? drag : p;
          return (
            <button key={p.id} id={`pin-${p.id}`} type="button" data-pin
              aria-label={`Comment ${p.n}: ${p.text}`} title={p.text}
              onPointerDown={(e) => pinDown(e, p)} onPointerMove={pinMove} onPointerUp={() => pinUp(p)}
              onClick={(e) => { e.stopPropagation(); if (!p.draggable || readOnly) onSelect?.(p.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.id); } else pinKey(e, p); }}
              className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-full touch-none', p.draggable && !readOnly ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
              style={{ left: `${live.x * 100}%`, top: `${live.y * 100}%` }}>
              <PinMark n={p.n} selected={selectedId === p.id} muted={p.muted} />
            </button>
          );
        })}
        {draft ? <DraftPopover x={draft.x} y={draft.y} n={pins.length + 1} onCancel={() => setDraft(null)} onSave={async (text, rule) => { await onCreate?.({ ...draft, text, rule }); setDraft(null); }} /> : null}
      </div>
    </div>
  );
}

function DraftPopover({ x, y, n, onSave, onCancel }: { x: number; y: number; n: number; onSave: (text: string, rule: boolean) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [rule, setRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => { if (!text.trim() || busy) return; setBusy(true); try { await onSave(text.trim(), rule); } finally { setBusy(false); } };
  const right = x > 0.6;
  return (
    <div data-draft className="absolute z-20" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onClick={(e) => e.stopPropagation()}>
      <div className="-translate-x-1/2 -translate-y-1/2"><PinMark n={n} selected /></div>
      <div className={cn('glass-strong absolute top-4 w-72 rounded-card p-3', right ? 'right-0' : 'left-0')} role="dialog" aria-label="New comment">
        <label className="sr-only" htmlFor="draft-text">Comment</label>
        <textarea id="draft-text" autoFocus rows={3} value={text} placeholder="What should change here?" className="field" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }} />
        <label className="mt-2 flex items-center gap-2 text-xs text-fg-2"><input type="checkbox" checked={rule} onChange={(e) => setRule(e.target.checked)} /> Also a pipeline rule</label>
        <div className="mt-2.5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </div>
  );
}
