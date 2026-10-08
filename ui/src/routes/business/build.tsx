import { useSearchParams } from 'react-router';
import { Segmented } from '../../components/ui/segmented';
import { ConceptsTab } from './concepts';
import { useBusiness } from './context';
import { PhotosTab } from './photos';
import { ProgressTab } from './progress';

type View = 'progress' | 'photos' | 'concepts';

/**
 * The Build tab: how the build is going, and the two places it stops for you. When the build is waiting
 * on photos or a concept, that view opens first; otherwise progress does.
 */
export function BuildTab() {
  const { build } = useBusiness();
  const [params, setParams] = useSearchParams();
  const rail = (k: string) => build?.rail.find((r) => r.key === k)?.status;
  const views: View[] = ['progress'];
  if (build && (build.state === 'awaiting_photos' || (rail('photos') && rail('photos') !== 'todo'))) views.push('photos');
  if (build && (build.state === 'awaiting_concept' || rail('concepts') === 'done' || rail('concepts') === 'waiting')) views.push('concepts');
  const waiting: View | null = build?.state === 'awaiting_photos' ? 'photos' : build?.state === 'awaiting_concept' ? 'concepts' : null;
  const asked = params.get('view') as View | null;
  const view: View = asked && views.includes(asked) ? asked : waiting ?? 'progress';
  const label: Record<View, string> = { progress: 'Progress', photos: waiting === 'photos' ? 'Photos · needs you' : 'Photos', concepts: waiting === 'concepts' ? 'Concepts · needs you' : 'Concepts' };

  return (
    <div className="flex flex-col gap-4">
      {views.length > 1 ? (
        <Segmented label="Build view" value={view} onChange={(v) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', v); return n; }, { replace: true })}
          options={views.map((v) => ({ value: v, label: label[v] }))} className="self-start" />
      ) : null}
      {view === 'photos' ? <PhotosTab /> : view === 'concepts' ? <ConceptsTab /> : <ProgressTab />}
    </div>
  );
}
