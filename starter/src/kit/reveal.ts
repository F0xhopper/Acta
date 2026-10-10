'use client';
/**
 * Reveal-on-scroll, as behaviour only: no styling. Returns a ref and whether the element has been seen.
 * The element is "seen" straight away when the visitor asks for reduced motion or the browser has no
 * IntersectionObserver, so nothing is ever hidden. Animate opacity and transform in your own CSS, e.g.
 *   const [ref, shown] = useReveal<HTMLDivElement>();
 *   <div ref={ref} data-shown={shown} className="reveal">…</div>
 * Managed by Acta: don't edit.
 */
import { useEffect, useRef, useState } from 'react';

export function useReveal<T extends Element>(opts: { rootMargin?: string; once?: boolean } = {}): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setShown(true); if (opts.once !== false) io.disconnect(); }
        else if (opts.once === false) setShown(false);
      }
    }, { rootMargin: opts.rootMargin ?? '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [opts.once, opts.rootMargin]);
  return [ref, shown];
}
