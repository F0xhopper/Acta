import { GitCompareArrows } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Device, FeedbackItem, Round } from '../../../../src/ui/api-types';
import { useRounds, useUpdateFeedback } from '../../api';
import { Button } from '../../components/ui/button';
import { Dot } from '../../components/ui/chip';
import { Empty } from '../../components/ui/empty';
import { Segmented } from '../../components/ui/segmented';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/states';
import { useToast } from '../../components/ui/toast';
import { dateOnly } from '../../lib/format';
import { useBusiness } from './context';
import { CompareView, type CompareMode } from './compare-view';
import { PinMark, type CanvasPin } from './pin-canvas';
import { DEVICE_SIZE } from './review-live';

const DEVICES: Device[] = ['mobile', 'tablet', 'desktop'];
const roundName = (r: number) => (r === 0 ? 'First build' : `Round ${r}`);

/** Comments sent in round `b` were pinned on the screenshots before it and acted on in round `b`. */
export function commentsFor(feedback: FeedbackItem[], roundB: number, page: string, device: Device): FeedbackItem[] {
  return feedback.filter((f) => f.round === roundB && (f.page === null || (f.page === page && (f.device ?? 'mobile') === device)));
}

export function CompareTab() {
  const { slug, build } = useBusiness();
  const rounds = useRounds(slug);
  const update = useUpdateFeedback();
  const toast = useToast();
  const list = useMemo(() => [...(rounds.data ?? [])].sort((a, b) => a.round - b.round), [rounds.data]);
  const [aSel, setA] = useState<number | null>(null);
  const [bSel, setB] = useState<number | null>(null);
  const [pageSel, setPage] = useState<string | null>(null);
  const [deviceSel, setDevice] = useState<Device>('mobile');
  const [mode, setMode] = useState<CompareMode>('slider');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (rounds.error) return <ErrorState error={rounds.error} what="review rounds" />;
  if (rounds.isLoading || !build) return <Skeleton className="h-[60vh]" />;
  if (list.length < 2) {
    return <Empty icon={GitCompareArrows}>Compare appears after the first revision. Send comments from the Review tab, and when the agent finishes you can check each one here.</Empty>;
  }

  const b = list.find((r) => r.round === bSel) ?? list[list.length - 1];
  const a = list.find((r) => r.round === aSel && r.round !== b.round) ?? [...list].reverse().find((r) => r.round < b.round) ?? list[0];
  const pageOf = (r: Round, path: string) => r.pages.find((p) => p.path === path);
  const paths = b.pages.map((p) => p.path).filter((p) => pageOf(a, p));
  const path = pageSel && paths.includes(pageSel) ? pageSel : paths[0];
  const pa = path ? pageOf(a, path) : undefined;
  const pb = path ? pageOf(b, path) : undefined;
  const devices = DEVICES.filter((d) => pa?.shots[d] && pb?.shots[d]);
  const device = devices.includes(deviceSel) ? deviceSel : devices[0];

  const comments = path && device ? commentsFor(build.feedback, b.round, path, device) : [];
  const ordered = [...comments].sort((x, y) => x.id - y.id);
  const pins: CanvasPin[] = ordered.filter((f) => f.page !== null && f.x !== null && f.y !== null).map((f) => ({ id: f.id, n: ordered.indexOf(f) + 1, x: f.x!, y: f.y!, text: f.text, muted: f.resolved === 'fixed' }));
  const allRound = build.feedback.filter((f) => f.round === b.round);
  const checked = allRound.filter((f) => f.resolved).length;

  const mark = (f: FeedbackItem, resolved: 'fixed' | 'not_fixed') => update.mutate({ id: f.id, patch: { resolved } }, {
    onSuccess: () => { if (resolved === 'not_fixed') toast({ kind: 'info', text: 'Marked not fixed. It carries into the next round\'s comments.' }); },
    onError: (e) => toast({ kind: 'error', text: `Couldn't save: ${e.message}` }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-wrap items-center gap-2 rounded-panel p-2 pl-4">
        <label className="flex items-center gap-2 text-sm text-fg-3">Before
          <select className="field h-8 w-auto text-xs" value={a.round} onChange={(e) => setA(Number(e.target.value))}>
            {list.filter((r) => r.round !== b.round).map((r) => <option key={r.round} value={r.round}>{roundName(r.round)} · {dateOnly(r.takenAt)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-3">After
          <select className="field h-8 w-auto text-xs" value={b.round} onChange={(e) => setB(Number(e.target.value))}>
            {list.filter((r) => r.round > 0).map((r) => <option key={r.round} value={r.round}>{roundName(r.round)} · {dateOnly(r.takenAt)}</option>)}
          </select>
        </label>
        {paths.length ? (
          <select aria-label="Page" className="field h-8 w-auto max-w-56 text-xs" value={path} onChange={(e) => setPage(e.target.value)}>
            {paths.map((p) => <option key={p} value={p}>{b.pages.find((x) => x.path === p)?.label ?? p}</option>)}
          </select>
        ) : null}
        <Segmented label="Device" size="sm" value={device ?? 'mobile'} onChange={setDevice} options={DEVICES.map((d) => ({ value: d, label: DEVICE_SIZE[d].label, disabled: !devices.includes(d) }))} />
        <Segmented label="Compare mode" size="sm" value={mode} onChange={setMode} className="ml-auto"
          options={[{ value: 'slider', label: 'Slider' }, { value: 'flip', label: 'Flip' }, { value: 'side', label: 'Side by side' }]} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="glass min-w-0 rounded-panel p-3">
          {pa && pb && device ? (
            <CompareView key={`${a.round}-${b.round}-${path}-${device}`} before={pa.shots[device]!} after={pb.shots[device]!}
              beforeLabel={roundName(a.round)} afterLabel={roundName(b.round)} mode={mode} pins={pins} selectedId={selectedId} onSelectPin={setSelectedId}
              maxWidth={mode === 'side' ? undefined : device === 'mobile' ? 430 : device === 'tablet' ? 860 : undefined} />
          ) : <Empty icon={GitCompareArrows}>These two rounds don't share a screenshot of this page. Pick another page or round.</Empty>}
        </div>

        <section className="glass rounded-panel p-4" aria-labelledby="cmp-h">
          <h2 id="cmp-h" className="text-sm font-medium">Comments acted on in {roundName(b.round).toLowerCase()}</h2>
          <p className="mt-0.5 text-xs text-fg-3">{checked} of {allRound.length} checked across every page. Pins show on the before side.</p>
          {ordered.length ? (
            <ol className="mt-3 flex flex-col gap-2">
              {ordered.map((f, i) => (
                <li key={f.id} className={`rounded-card border p-3 ${selectedId === f.id ? 'border-border bg-white/[0.07]' : 'border-border-soft'}`}>
                  <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setSelectedId(f.id)}>
                    {f.page !== null ? <PinMark n={i + 1} selected={selectedId === f.id} muted={f.resolved === 'fixed'} className="mt-0.5 size-5 shrink-0 text-[10px]" /> : <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border text-[10px]">{i + 1}</span>}
                    <span className="text-sm text-fg-2">{f.text}</span>
                  </button>
                  {f.cropUrl ? <img src={f.cropUrl} alt="The spot the comment was about" className="mt-2 w-full rounded-[10px]" /> : null}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={f.resolved === 'fixed' ? 'primary' : 'outline'} aria-pressed={f.resolved === 'fixed'} onClick={() => mark(f, 'fixed')}>Fixed</Button>
                    <Button size="sm" variant={f.resolved === 'not_fixed' ? 'secondary' : 'outline'} aria-pressed={f.resolved === 'not_fixed'} onClick={() => mark(f, 'not_fixed')}>
                      {f.resolved === 'not_fixed' ? <Dot tone="bad" /> : null}Not fixed
                    </Button>
                  </div>
                  {f.resolved === 'not_fixed' ? <p className="mt-1.5 text-xs text-fg-3">Carries into the next round's comments.</p> : null}
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 text-sm text-fg-3">No comments from this round on this page and device.</p>}
        </section>
      </div>
    </div>
  );
}
