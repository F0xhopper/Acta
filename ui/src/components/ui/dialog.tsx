import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

/** A modal on the native <dialog>: focus trap, Escape and inert background for free. */
export function Dialog({ open, onClose, title, children, actions, wide }: { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`glass-strong m-auto rounded-panel p-0 text-fg-2 backdrop:bg-black/60 backdrop:backdrop-blur-sm ${wide ? 'w-[min(720px,calc(100vw-2rem))]' : 'w-[min(460px,calc(100vw-2rem))]'}`}>
      {open ? (
        <>
          <div className="px-5 pt-5 pb-4">
            <h2 className="text-lg">{title}</h2>
            {children ? <div className="mt-2 text-sm">{children}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft px-5 py-3">{actions}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

/** Confirm a costly or destructive action. The button says the verb; the body says the consequence in one sentence. */
export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; children?: ReactNode; confirmLabel?: string; busy?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} actions={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} onClick={onConfirm} autoFocus>{confirmLabel}</Button>
    </>}>{children}</Dialog>
  );
}
