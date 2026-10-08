import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Dot } from './chip';

/** Toasts: quiet confirmations, with an optional Undo or link. Errors stay longer. */
export interface ToastInput { text: string; kind?: 'ok' | 'error' | 'info'; action?: { label: string; onClick: () => void }; link?: { to: string; label: string }; ms?: number }
interface ToastItem extends ToastInput { id: number }
const Ctx = createContext<(t: ToastInput) => void>(() => undefined);
export const useToast = () => useContext(Ctx);

let nextId = 1;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((x) => x.id !== id)), []);
  const push = useCallback((t: ToastInput) => {
    const id = nextId++;
    setItems((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.ms ?? (t.kind === 'error' ? 9000 : t.action ? 10000 : 5000));
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-2.5 glass-strong rounded-card px-4 py-3 text-sm text-fg">
            <Dot tone={t.kind === 'error' ? 'bad' : t.kind === 'ok' ? 'ok' : 'info'} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <p className="break-words">{t.text}</p>
              {t.link ? <Link to={t.link.to} className="text-xs font-medium underline underline-offset-2" onClick={() => dismiss(t.id)}>{t.link.label}</Link> : null}
            </div>
            {t.action ? <button type="button" className="text-sm font-semibold underline underline-offset-2" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button> : null}
            <button type="button" aria-label="Dismiss" className="text-fg-3 hover:text-fg" onClick={() => dismiss(t.id)}><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
