import { useCallback, useEffect, useRef, useState } from 'react';

/** Copy text to the clipboard; `copied` is true for two seconds afterwards. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, []);
  return { copy, copied };
}

/** A value saved a moment after the last change. Returns the save state for a quiet "Saved" note. */
export function useAutosave<T>(value: T, original: T, save: (v: T) => Promise<unknown>, ms = 800) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveRef = useRef(save); saveRef.current = save;
  const last = useRef(original);
  useEffect(() => { last.current = original; }, [original]);
  useEffect(() => {
    if (Object.is(value, last.current)) return;
    const t = setTimeout(() => {
      setState('saving');
      saveRef.current(value).then(() => { last.current = value; setState('saved'); }).catch(() => setState('error'));
    }, ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return state;
}
