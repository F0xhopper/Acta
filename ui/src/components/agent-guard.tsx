import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ApiError, useUsage } from '../api';
import type { Usage } from '../../../src/ui/api-types';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { useToast } from './ui/toast';
import { UsageBars } from './shell/usage';

/**
 * The usage pre-flight. Every action that starts an agent run goes through `guard`:
 * well under the limit it runs at once; within ten points it asks; at or over the limit it is blocked
 * with an explicit "Start anyway". The server enforces the same limit and answers 409 code "usage",
 * which lands in the blocked dialog too.
 */
type Run<T> = (override: boolean) => Promise<T>;
type Guard = <T>(label: string, run: Run<T>) => Promise<T | undefined>;
const Ctx = createContext<Guard>(async (_l, run) => run(false));
export const useAgentGuard = () => useContext(Ctx);

export function usageLevel(u: Usage | null | undefined): 'ok' | 'warn' | 'over' | 'unknown' {
  if (!u || (u.session === null && u.week === null)) return 'unknown';
  const top = Math.max(u.session ?? 0, u.week ?? 0);
  if (top >= u.stopAt) return 'over';
  if (top >= u.warnAt) return 'warn';
  return 'ok';
}

interface Pending { kind: 'warn' | 'blocked'; label: string; reason?: string; run: Run<unknown>; resolve: (v: unknown) => void }

export function AgentGuardProvider({ children }: { children: ReactNode }) {
  const usage = useUsage().data;
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const usageRef = useRef(usage); usageRef.current = usage;

  const attempt = useCallback(async (label: string, run: Run<unknown>, override: boolean, resolve: (v: unknown) => void) => {
    try {
      resolve(await run(override));
      setPending(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'usage' && !override) { setPending({ kind: 'blocked', label, reason: e.message, run, resolve }); return; }
      setPending(null);
      toast({ kind: 'error', text: `${label}: ${(e as Error).message}` });
      resolve(undefined);
    }
  }, [toast]);

  const guard = useCallback(<T,>(label: string, run: Run<T>) => new Promise<T | undefined>((resolve) => {
    const level = usageLevel(usageRef.current);
    const r = resolve as (v: unknown) => void;
    if (level === 'warn') setPending({ kind: 'warn', label, run, resolve: r });
    else if (level === 'over') setPending({ kind: 'blocked', label, run, resolve: r });
    else void attempt(label, run, false, r);
  }), [attempt]);

  const go = async (override: boolean) => { if (!pending) return; setBusy(true); await attempt(pending.label, pending.run, override, pending.resolve); setBusy(false); };
  const cancel = () => { pending?.resolve(undefined); setPending(null); };

  return (
    <Ctx.Provider value={guard as Guard}>
      {children}
      <Dialog open={!!pending} onClose={cancel}
        title={pending?.kind === 'blocked' ? 'Claude usage is at the limit' : 'Claude usage is getting close to the limit'}
        actions={<>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void go(pending?.kind === 'blocked')}>{pending?.kind === 'blocked' ? 'Start anyway' : 'Start'}</Button>
        </>}>
        <p>{pending?.label} starts an agent run. {pending?.kind === 'blocked'
          ? 'Builds stop at this limit so the rest of your week stays usable. Starting anyway may run into the limit part way through.'
          : 'A build can use a large share of a session.'}</p>
        {pending?.reason ? <p className="mt-2 text-fg-3">{pending.reason}</p> : null}
        <div className="mt-3"><UsageBars usage={usage} /></div>
      </Dialog>
    </Ctx.Provider>
  );
}
