import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { PinMark, type CanvasPin } from './pin-canvas';

export type CompareMode = 'slider' | 'flip' | 'side';

/** The divider position after a key press, or null when the key doesn't move it. */
export function sliderKey(pos: number, key: string): number | null {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return clamp(pos - 5);
    case 'ArrowRight': case 'ArrowUp': return clamp(pos + 5);
    case 'PageDown': return clamp(pos - 20);
    case 'PageUp': return clamp(pos + 20);
    case 'Home': return 0;
    case 'End': return 100;
    default: return null;
  }
}

/** Pins drawn over an image, read-only. */
function Pins({ pins, selectedId, onSelect }: { pins: CanvasPin[]; selectedId: number | null; onSelect: (id: number) => void }) {
  return <>{pins.map((p) => (
    <button key={p.id} type="button" onClick={() => onSelect(p.id)} aria-label={`Comment ${p.n}: ${p.text}`} title={p.text}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
      <PinMark n={p.n} selected={selectedId === p.id} muted={p.muted} />
    </button>
  ))}</>;
}

function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('glass-strong pointer-events-none absolute top-3 z-20 rounded-full px-2.5 py-0.5 text-xs text-fg', className)}>{children}</span>;
}

/**
 * Two screenshots compared three ways. Slider: the before image sits on top, clipped at the divider.
 * Flip: one image at a time, Space swaps. Side by side: two columns. Images align at the top; a shorter
 * one shows the checker pattern beneath it.
 */
export function CompareView({ before, after, beforeLabel, afterLabel, mode, pins, selectedId, onSelectPin, maxWidth }: {
  before: string; after: string; beforeLabel: string; afterLabel: string; mode: CompareMode;
  pins: CanvasPin[]; selectedId: number | null; onSelectPin: (id: number) => void; maxWidth?: number;
}) {
  const [pos, setPos] = useState(50);
  const [showing, setShowing] = useState<'before' | 'after'>('before');
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (mode !== 'flip') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName))) return;
      e.preventDefault();
      setShowing((s) => (s === 'before' ? 'after' : 'before'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const fromPointer = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  if (mode === 'side') {
    return (
      <div className="grid grid-cols-2 items-start gap-3">
        {[{ src: before, label: beforeLabel, pins: true }, { src: after, label: afterLabel, pins: false }].map((s) => (
          <figure key={s.label} className="checker relative overflow-hidden rounded-[14px]">
            <Tag className="left-3">{s.label}</Tag>
            <div className="relative"><img src={s.src} alt={s.label} className="block h-auto w-full" draggable={false} />{s.pins ? <Pins pins={pins} selectedId={selectedId} onSelect={onSelectPin} /> : null}</div>
          </figure>
        ))}
      </div>
    );
  }

  if (mode === 'flip') {
    const isBefore = showing === 'before';
    return (
      <div className="mx-auto w-full" style={maxWidth ? { maxWidth } : undefined}>
        <div tabIndex={0} role="group" aria-label={`Showing ${isBefore ? beforeLabel : afterLabel}. Press Space to flip.`}
          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setShowing(isBefore ? 'after' : 'before'); } }}
          onClick={() => setShowing(isBefore ? 'after' : 'before')}
          className="checker relative cursor-pointer overflow-hidden rounded-[14px]">
          <Tag className="left-3">{isBefore ? `Before · ${beforeLabel}` : `After · ${afterLabel}`}</Tag>
          <div className="relative">
            <img src={isBefore ? before : after} alt={isBefore ? beforeLabel : afterLabel} className="block h-auto w-full" draggable={false} />
            {isBefore ? <Pins pins={pins} selectedId={selectedId} onSelect={onSelectPin} /> : null}
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-fg-3">Click the image or press Space to flip between before and after.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full" style={maxWidth ? { maxWidth } : undefined}>
      <div ref={box} className="checker relative grid touch-none items-start overflow-hidden rounded-[14px] select-none"
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); fromPointer(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) fromPointer(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
        <div className="relative [grid-area:1/1]"><img src={after} alt={afterLabel} className="block h-auto w-full" draggable={false} /></div>
        <div className="relative [grid-area:1/1]" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={before} alt={beforeLabel} className="block h-auto w-full" draggable={false} />
          <Pins pins={pins} selectedId={selectedId} onSelect={onSelectPin} />
        </div>
        <Tag className="left-3">Before · {beforeLabel}</Tag>
        <Tag className="right-3">After · {afterLabel}</Tag>
        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/80 shadow-[0_0_8px_rgba(0,0,0,0.6)]" style={{ left: `${pos}%` }} />
        <div role="slider" tabIndex={0} aria-label="Before and after divider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} aria-valuetext={`${Math.round(pos)}% before`}
          onKeyDown={(e) => { const n = sliderKey(pos, e.key); if (n !== null) { e.preventDefault(); setPos(n); } }}
          className="glass-strong absolute top-24 z-20 grid size-9 -translate-x-1/2 cursor-ew-resize place-items-center rounded-full text-fg" style={{ left: `${pos}%` }}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden><path d="M6 4 2 8l4 4M10 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </div>
    </div>
  );
}
