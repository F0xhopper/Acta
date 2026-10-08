import { Camera } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Device, FeedbackItem } from '../../../../src/ui/api-types';
import { useAddFeedback, useApprove, useDeleteFeedback, useRefreshShots, useSendFeedback, useUpdateFeedback } from '../../api';
import { useAgentGuard } from '../../components/agent-guard';
import { Button } from '../../components/ui/button';
import { Chip, Kbd } from '../../components/ui/chip';
import { Confirm } from '../../components/ui/dialog';
import { Empty } from '../../components/ui/empty';
import { Notice } from '../../components/ui/notice';
import { Segmented } from '../../components/ui/segmented';
import { Skeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { plural } from '../../lib/format';
import { useBusiness } from './context';
import { PinCanvas, type CanvasPin } from './pin-canvas';
import { CompareTab } from './compare';
import { CommentsPanel } from './review-comments';
import { DEVICE_SIZE, LiveFrame } from './review-live';
import { bizPath } from '../../lib/links';

const DEVICES: Device[] = ['mobile', 'tablet', 'desktop'];
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function ReviewTab() {
  const { slug, build, buildLoading } = useBusiness();
  const navigate = useNavigate();
  const toast = useToast();
  const guard = useAgentGuard();
  const [params, setParams] = useSearchParams();
  // In Comment mode a click on the screenshot always starts a comment: no separate toggle to find.
  const commentMode = true;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const add = useAddFeedback();
  const update = useUpdateFeedback();
  const send = useSendFeedback();
  const approve = useApprove();
  const shots = useRefreshShots();
  const del = useDeleteFeedback();

  const pages = build?.pages ?? [];
  const pagePath = params.get('page') && pages.some((p) => p.path === params.get('page')) ? params.get('page')! : pages[0]?.path ?? '/';
  const page = pages.find((p) => p.path === pagePath);
  const available = DEVICES.filter((d) => page?.shots[d]);
  const wanted = params.get('device') as Device | null;
  const device: Device = wanted && available.includes(wanted) ? wanted : available[0] ?? 'mobile';
  const requested = params.get('mode');
  const mode: 'live' | 'annotate' | 'compare' = requested === 'compare' && (build?.rounds ?? 0) >= 1 ? 'compare' : requested === 'live' && build?.previewUrl ? 'live' : requested === 'annotate' ? 'annotate' : !requested && !pages.length && build?.previewUrl ? 'live' : 'annotate';

  const set = (patch: Record<string, string>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) n.set(k, v); return n; }, { replace: true });

  const unsent = useMemo(() => (build?.feedback ?? []).filter((f) => f.round === null).sort((a, b) => a.id - b.id), [build?.feedback]);
  const numbers = useMemo(() => new Map(unsent.map((f, i) => [f.id, i + 1])), [unsent]);
  const pins: CanvasPin[] = unsent.filter((f) => f.page === pagePath && (f.device ?? 'mobile') === device && f.x !== null && f.y !== null)
    .map((f) => ({ id: f.id, n: numbers.get(f.id) ?? 0, x: f.x!, y: f.y!, text: f.text, draggable: true }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') set({ mode: 'annotate' });
      else if (['1', '2', '3'].includes(e.key)) { const d = DEVICES[Number(e.key) - 1]; if (available.includes(d)) set({ device: d }); }
      else if ((e.key === '[' || e.key === ']') && pages.length) {
        const i = pages.findIndex((p) => p.path === pagePath);
        const next = pages[(i + (e.key === ']' ? 1 : -1) + pages.length) % pages.length];
        set({ page: next.path });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (buildLoading || !build) return <div className="grid gap-4 lg:grid-cols-[1fr_340px]"><Skeleton className="h-[60vh]" /><Skeleton className="h-80" /></div>;

  const selectComment = (f: FeedbackItem) => {
    setSelectedId(f.id);
    if (f.page !== null) {
      set({ page: f.page, device: f.device ?? 'mobile', mode: 'annotate' });
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`pin-${f.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })));
    }
  };
  const retake = () => shots.mutate(slug, { onSuccess: () => toast({ text: 'Taking fresh screenshots of every page', kind: 'info' }), onError: (e) => toast({ kind: 'error', text: `Couldn't start screenshots: ${e.message}` }) });
  const sendBack = async () => {
    const round = build.rounds + 1;
    const job = await guard(`Send round ${round} to the agent`, (override) => send.mutateAsync({ slug, override }));
    if (job) { toast({ kind: 'ok', text: `Round ${round} sent: ${plural(unsent.length, 'comment')} going to the agent` }); navigate(bizPath(slug, 'progress')); }
  };
  const doApprove = async (discard = false) => {
    if (discard) {
      try { await Promise.all(unsent.map((f) => del.mutateAsync(f.id))); } catch (e) { setConfirmApprove(false); toast({ kind: 'error', text: `Couldn't discard the comments: ${(e as Error).message}` }); return; }
    }
    approve.mutate(slug, {
    onSuccess: (r) => {
      setConfirmApprove(false);
      if (!r.ok) { toast({ kind: 'error', text: r.message }); return; }
      toast({ kind: 'ok', text: 'Approved. The delivery package is ready.' });
      navigate(bizPath(slug, 'deliver'));
    },
    onError: (e) => { setConfirmApprove(false); toast({ kind: 'error', text: `Couldn't approve: ${e.message}` }); },
    });
  };
  const canApprove = build.state === 'preview_ready';
  const busyBuilding = build.activeJobId !== null && !build.shotsTaking;

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-wrap items-center gap-2 rounded-panel p-2 pl-4">
        <Segmented label="View" size="sm" value={mode} onChange={(m) => set({ mode: m })}
          options={[{ value: 'annotate', label: 'Comment' }, { value: 'live', label: 'Live site', disabled: !build.previewUrl }, ...(build.rounds >= 1 ? [{ value: 'compare' as const, label: 'Compare' }] : [])]} />
        {mode !== 'compare' ? <Segmented label="Device" size="sm" value={device} onChange={(d) => set({ device: d })}
          options={DEVICES.map((d) => ({ value: d, label: DEVICE_SIZE[d].label, disabled: mode === 'annotate' && !page?.shots[d] }))} /> : null}
        {pages.length && mode !== 'compare' ? (
          <select aria-label="Page" className="field h-8 w-auto max-w-56 text-xs" value={pagePath} onChange={(e) => set({ page: e.target.value })}>
            {pages.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
          </select>
        ) : null}
        {mode === 'annotate' ? <Button size="sm" variant="ghost" loading={build.shotsTaking || shots.isPending} onClick={retake} title="Take fresh screenshots of every page"><Camera className="size-3.5" aria-hidden />Refresh</Button> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {build.state === 'approved' ? <Chip dot="ok">Approved</Chip> : null}
          <Button variant="secondary" disabled={!unsent.length || busyBuilding} loading={send.isPending} onClick={() => void sendBack()} title="Send your comments to the agent, which makes the changes and comes back for review">Request changes{unsent.length ? ` (${unsent.length})` : ''}</Button>
          <Button variant="primary" disabled={!canApprove} loading={approve.isPending} title={canApprove ? undefined : 'Only a finished preview can be approved'}
            onClick={() => (unsent.length ? setConfirmApprove(true) : void doApprove())}>Approve</Button>
        </div>
      </div>

      {busyBuilding ? <Notice tone="info" title="The agent is working on this site">Screenshots and the live preview show the last finished round until it's done.</Notice> : null}

      {mode === 'compare' ? <CompareTab /> : (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {mode === 'live' && build.previewUrl ? (
            <LiveFrame url={build.previewUrl} device={device} path={pagePath} />
          ) : !build.previewUrl && !pages.length ? (
            <Empty icon={Camera} action={<Button variant="primary" loading={build.shotsTaking || shots.isPending} onClick={retake}>Take screenshots</Button>}>
              There are no screenshots yet, and the site isn't deployed. Take screenshots of the local build to start reviewing.
            </Empty>
          ) : !pages.length ? (
            <Empty icon={Camera} action={<Button variant="primary" loading={build.shotsTaking || shots.isPending} onClick={retake}>Take screenshots</Button>}>No screenshots yet. Take them to pin comments on each page.</Empty>
          ) : page?.shots[device] ? (
            <div className="glass max-h-[calc(100vh-240px)] min-h-80 overflow-auto rounded-panel p-3">
              <PinCanvas src={page.shots[device]!} alt={`${page.label} on ${DEVICE_SIZE[device].label.toLowerCase()}`} pins={pins} selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)} commentMode={commentMode} maxWidth={device === 'mobile' ? 430 : device === 'tablet' ? 860 : undefined}
                onCreate={(p) => add.mutateAsync({ slug, item: { page: pagePath, device, x: p.x, y: p.y, text: p.text, rule: p.rule } })
                  .then((f) => setSelectedId(f.id)).catch((e: Error) => toast({ kind: 'error', text: `Couldn't save the comment: ${e.message}` }))}
                onMove={(id, x, y) => update.mutate({ id, patch: { x, y } }, { onError: (e) => toast({ kind: 'error', text: `Couldn't move the pin: ${e.message}` }) })} />
            </div>
          ) : (
            <Empty icon={Camera}>No {DEVICE_SIZE[device].label.toLowerCase()} screenshot of this page. Retake screenshots or pick another device.</Empty>
          )}
          {mode === 'annotate' && pages.length ? (
            <p className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3 md:flex">
              <span>Click anywhere to comment</span><span><Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd> device</span><span><Kbd>[</Kbd><Kbd>]</Kbd> page</span><span>Drag a pin to move it</span>
            </p>
          ) : null}
        </div>
        <CommentsPanel build={build} unsent={unsent} numbers={numbers} selectedId={selectedId} onSelect={selectComment} generalBusy={add.isPending}
          onGeneral={(text) => add.mutateAsync({ slug, item: { page: null, device: null, x: null, y: null, text } }).then(() => undefined)
            .catch((e: Error) => { toast({ kind: 'error', text: `Couldn't add the note: ${e.message}` }); })} />
      </div>
      )}

      <Confirm open={confirmApprove} onClose={() => setConfirmApprove(false)} onConfirm={() => void doApprove(true)} busy={approve.isPending || del.isPending}
        title={`Discard ${plural(unsent.length, 'unsent comment')} and approve?`} confirmLabel="Discard and approve">
        The comments won't reach the agent. The site is approved as it is now.
      </Confirm>
    </div>
  );
}
