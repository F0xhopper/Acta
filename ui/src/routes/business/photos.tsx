import { ChevronLeft, ChevronRight, ImageOff, Images } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Photo, PhotoSet } from '../../../../src/ui/api-types';
import { usePhotos, useSavePhotos, useSkipPhotos, type JobOk } from '../../api';
import { useAgentGuard } from '../../components/agent-guard';
import { Button } from '../../components/ui/button';
import { Confirm } from '../../components/ui/dialog';
import { Chip, Dot, Kbd } from '../../components/ui/chip';
import { Dialog } from '../../components/ui/dialog';
import { Empty } from '../../components/ui/empty';
import { Notice } from '../../components/ui/notice';
import { Section } from '../../components/ui/section';
import { SkeletonRows } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/states';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { plural } from '../../lib/format';
import { useBusiness } from './context';
import { counts, initialSort, setChoice, setReason, sortRemaining, toChoices, type Choice, type SortState } from './photos-state';
import { bizPath } from '../../lib/links';

/** Photo curator (feature 10): sort every gathered photo into keep, drop or hero before the agent designs around them. */
export function PhotosTab() {
  const { slug } = useBusiness();
  const photos = usePhotos(slug);
  if (photos.error) return <ErrorState error={photos.error} what="photos" />;
  if (!photos.data) return <SkeletonRows rows={4} />;
  if (!photos.data.photos.length) return <Empty icon={ImageOff}>No photos were gathered for this business. The site will be designed with type and colour, with named placeholders for photos to shoot.</Empty>;
  return <PhotoSorter key={photos.data.photos.map((p) => p.path).join('|')} slug={slug} set={photos.data} />;
}

const CHOICES: { value: Exclude<Choice, null>; label: string; key: string }[] = [
  { value: 'keep', label: 'Keep', key: 'K' },
  { value: 'drop', label: 'Drop', key: 'D' },
  { value: 'hero', label: 'Hero', key: 'H' },
];

function PhotoSorter({ slug, set }: { slug: string; set: PhotoSet }) {
  const list = set.photos;
  const [state, setState] = useState<SortState>(() => initialSort(list));
  const [focus, setFocus] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const save = useSavePhotos();
  const skip = useSkipPhotos();
  const guard = useAgentGuard();
  const toast = useToast();
  const navigate = useNavigate();
  const c = counts(state, list);

  const decide = (i: number, choice: Exclude<Choice, null>) => setState((s) => setChoice(s, list[i].path, choice));

  /** Columns in the rendered grid: tiles sharing the first tile's top edge. */
  const columns = () => {
    const els = tiles.current.filter(Boolean) as HTMLDivElement[];
    if (els.length < 2) return 1;
    const top = els[0].offsetTop;
    const n = els.filter((e) => e.offsetTop === top).length;
    return Math.max(1, n);
  };
  const move = (to: number) => { const i = Math.max(0, Math.min(list.length - 1, to)); setFocus(i); tiles.current[i]?.focus(); };

  const onTileKey = (i: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === 'k' || k === 'd' || k === 'h') { e.preventDefault(); decide(i, k === 'k' ? 'keep' : k === 'd' ? 'drop' : 'hero'); return; }
    if (e.target !== e.currentTarget) return; // let buttons inside the tile handle their own keys
    const cols = columns();
    if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(i + cols); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - cols); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(list.length - 1); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setLightbox(i); }
  };

  const done = (r: JobOk | undefined) => {
    if (!r) return;
    toast({ kind: r.ok ? 'ok' : 'error', text: r.message });
    if (r.ok && r.job) navigate(bizPath(slug, 'progress'));
  };
  const [askNone, setAskNone] = useState(false);
  const sortedAny = Object.values(state.choices).some((c) => c !== null);
  const hasHero = Object.values(state.choices).includes('hero');
  const continueBuild = async () => done(await guard('Continue the build', (override) => save.mutateAsync({ slug, choices: toChoices(state, list), resume: true, override })));
  /** Nothing sorted, or no hero chosen: ask first, so a click on Save never keeps every photo by accident. */
  const saveAndContinue = () => { if (!sortedAny || !hasHero) setAskNone(true); else void continueBuild(); };
  const saveOnly = async () => {
    try { done(await save.mutateAsync({ slug, choices: toChoices(state, list), resume: false })); }
    catch (e) { toast({ kind: 'error', text: `Couldn't save: ${(e as Error).message}` }); }
  };
  const skipAuto = async () => done(await guard('Continue the build', (override) => skip.mutateAsync({ slug, override })));

  return (
    <div className="flex flex-col gap-4">
      <Confirm open={askNone} onClose={() => setAskNone(false)} confirmLabel={sortedAny ? 'Continue without a hero' : `Keep all ${list.length}`}
        onConfirm={() => { setAskNone(false); void continueBuild(); }}
        title={sortedAny ? 'No hero photo chosen' : "You haven't sorted any photos"}>
        {sortedAny ? 'The agent will pick the hero itself.' : `Every photo will be kept, including any doorstep, cluttered or close-up shots, and the agent won't drop them. Sort them first for a better site.`}
      </Confirm>
      {set.waiting ? (
        <Notice tone="warn" title="The build is waiting for you">Sort the photos, then continue. The agent treats dropped photos as unusable and builds the home page around the hero.</Notice>
      ) : (
        <Notice tone="info">{set.curated ? 'You sorted these photos before.' : 'These photos were sorted automatically.'} Changes here apply to the next build or revision.</Notice>
      )}

      <Section
        title={<div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-fg">{plural(list.length, 'photo')}</span>
          <Chip dot="ok">{c.kept} kept</Chip>
          <Chip dot="bad">{c.dropped} dropped</Chip>
          <Chip hollow>{c.unsorted} unsorted</Chip>
          {c.hero ? <Chip dot="warn">Hero chosen</Chip> : <Chip hollow>No hero yet</Chip>}
        </div>}
        actions={<>
          <Button size="sm" variant="outline" disabled={!c.unsorted} onClick={() => setState((s) => sortRemaining(s, list, 'keep'))}>Keep all unsorted</Button>
          <Button size="sm" variant="outline" disabled={!c.unsorted} onClick={() => setState((s) => sortRemaining(s, list, 'drop'))}>Drop all unsorted</Button>
        </>}
        bodyClassName="p-4 md:p-5"
      >
        {c.kept < 6 ? <Notice tone="warn" className="mb-4">Fewer than six photos are kept. The site will lean on type and colour.</Notice> : null}
        <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
          Arrow keys move between photos. <Kbd>K</Kbd> keep, <Kbd>D</Kbd> drop, <Kbd>H</Kbd> hero, <Kbd>Space</Kbd> to look closer.
        </p>
        <div role="list" aria-label="Gathered photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((p, i) => (
            <PhotoTile key={p.path} photo={p} index={i} choice={state.choices[p.path] ?? null} reason={state.reasons[p.path] ?? null} reasons={set.reasons}
              tabIndex={i === focus ? 0 : -1} tileRef={(el) => { tiles.current[i] = el; }}
              onFocus={() => setFocus(i)} onKeyDown={onTileKey(i)} onDecide={(ch) => decide(i, ch)}
              onReason={(r) => setState((s) => setReason(s, p.path, r))} onOpen={() => setLightbox(i)} />
          ))}
        </div>
        {set.dropStats.length ? (
          <p className="mt-4 text-xs text-fg-3">Across all sites you've dropped: {set.dropStats.map((d) => `${d.reason} ${d.count}`).join(', ')}.</p>
        ) : null}
      </Section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {set.waiting ? (
          <>
            <Button variant="ghost" loading={skip.isPending} onClick={() => void skipAuto()}>Skip, use the automatic choice</Button>
            <div className="flex flex-col items-end gap-1">
              <Button variant="primary" size="lg" loading={save.isPending} onClick={saveAndContinue}>Save and continue build</Button>
              {c.unsorted ? <span className="text-xs text-fg-3">{plural(c.unsorted, 'unsorted photo')} will be kept.</span> : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button variant="primary" loading={save.isPending} onClick={() => void saveOnly()}>Save choices</Button>
            {c.unsorted ? <span className="text-xs text-fg-3">{plural(c.unsorted, 'unsorted photo')} will be kept.</span> : null}
          </div>
        )}
      </div>

      <Lightbox photos={list} index={lightbox} state={state} onIndex={setLightbox} onDecide={(i, ch) => decide(i, ch)}
        onClose={() => { const i = lightbox; setLightbox(null); if (i !== null) requestAnimationFrame(() => tiles.current[i]?.focus()); }} />
    </div>
  );
}

const CHOICE_DOT = { keep: 'ok', drop: 'bad', hero: 'warn' } as const;

function PhotoTile({ photo, index, choice, reason, reasons, tabIndex, tileRef, onFocus, onKeyDown, onDecide, onReason, onOpen }: {
  photo: Photo; index: number; choice: Choice; reason: string | null; reasons: string[]; tabIndex: number;
  tileRef: (el: HTMLDivElement | null) => void; onFocus: () => void; onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onDecide: (c: Exclude<Choice, null>) => void; onReason: (r: string) => void; onOpen: () => void;
}) {
  const label = `Photo ${index + 1}, ${photo.alt ?? photo.source}, ${choice ?? 'unsorted'}`;
  return (
    <div role="listitem" ref={tileRef} tabIndex={tabIndex} aria-label={label} onFocus={onFocus} onKeyDown={onKeyDown}
      className={cn('flex flex-col gap-2 rounded-card p-2 outline-offset-2', choice === 'hero' ? 'glass-lit' : 'glass')}>
      <button type="button" tabIndex={-1} onClick={onOpen} className="relative block overflow-hidden rounded-[14px] bg-white/5" aria-label={`Look closer at photo ${index + 1}`}>
        <img src={photo.url} alt={photo.alt ?? ''} loading="lazy" className={cn('aspect-[4/3] w-full object-cover transition-[opacity,filter] duration-150', choice === 'drop' && 'opacity-35 grayscale')} />
        {choice ? <span className="glass-strong absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-fg"><Dot tone={CHOICE_DOT[choice]} />{choice === 'hero' ? 'Hero' : choice === 'keep' ? 'Kept' : 'Dropped'}</span> : null}
      </button>
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-fg-3">
        <span className="truncate capitalize">{photo.source}</span>
        <span>{photo.width}×{photo.height}</span>
      </div>
      <div className="flex gap-1" role="group" aria-label={`Choice for photo ${index + 1}`}>
        {CHOICES.map((o) => (
          <button key={o.value} type="button" tabIndex={tabIndex} aria-pressed={choice === o.value} title={`${o.label} (${o.key})`} onClick={() => onDecide(o.value)}
            className={cn('h-7 flex-1 rounded-full border text-xs font-medium transition-colors duration-100',
              choice === o.value ? 'border-white/20 bg-white/15 text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]' : 'border-border-soft text-fg-3 hover:bg-white/[0.06] hover:text-fg-2')}>
            {o.label}
          </button>
        ))}
      </div>
      {choice === 'drop' && reasons.length ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Why drop it">
          {reasons.map((r) => (
            <button key={r} type="button" tabIndex={tabIndex} aria-pressed={reason === r} onClick={() => onReason(r)}
              className={cn('h-6 rounded-full border px-2 text-[11px] transition-colors', reason === r ? 'border-white/20 bg-white/15 text-fg' : 'border-border-soft text-fg-3 hover:text-fg-2')}>{r}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Lightbox({ photos, index, state, onIndex, onDecide, onClose }: { photos: Photo[]; index: number | null; state: SortState; onIndex: (i: number) => void; onDecide: (i: number, c: Exclude<Choice, null>) => void; onClose: () => void }) {
  const open = index !== null;
  const p = open ? photos[index] : null;
  const choice = p ? state.choices[p.path] ?? null : null;
  const step = useMemo(() => (d: number) => { if (index === null) return; onIndex((index + d + photos.length) % photos.length); }, [index, photos.length, onIndex]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (index !== null && !e.metaKey && !e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'k' || k === 'd' || k === 'h') { e.preventDefault(); onDecide(index, k === 'k' ? 'keep' : k === 'd' ? 'drop' : 'hero'); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, step, index, onDecide]);
  return (
    <Dialog open={open} onClose={onClose} wide title={p ? `Photo ${index! + 1} of ${photos.length}` : ''}
      actions={p ? <>
        <Button variant="ghost" onClick={() => step(-1)} aria-label="Previous photo"><ChevronLeft className="size-4" aria-hidden />Previous</Button>
        <Button variant="ghost" onClick={() => step(1)} aria-label="Next photo">Next<ChevronRight className="size-4" aria-hidden /></Button>
        <span className="flex-1" />
        {CHOICES.map((o) => <Button key={o.value} variant={choice === o.value ? 'primary' : 'secondary'} aria-pressed={choice === o.value} onClick={() => onDecide(index!, o.value)}>{o.label}</Button>)}
        <Button variant="outline" onClick={onClose}>Done</Button>
      </> : null}>
      {p ? (
        <div>
          <img src={p.url} alt={p.alt ?? ''} className="max-h-[65vh] w-full rounded-card bg-white/5 object-contain" />
          <p className="mt-2 text-xs text-fg-3"><span className="capitalize">{p.source}</span> · {p.width}×{p.height}{p.alt ? ` · ${p.alt}` : ''}</p>
        </div>
      ) : <Images className="size-6 text-fg-4" aria-hidden />}
    </Dialog>
  );
}
