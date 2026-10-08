import { ChevronDown, FileText, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Concept, ConceptSet, Device } from '../../../../src/ui/api-types';
import { useChooseConcept, useConcepts, useRegenerateConcepts, type JobOk } from '../../api';
import { useAgentGuard } from '../../components/agent-guard';
import { Button, ButtonA } from '../../components/ui/button';
import { Chip } from '../../components/ui/chip';
import { Dialog } from '../../components/ui/dialog';
import { Empty } from '../../components/ui/empty';
import { Markdown } from '../../components/ui/markdown';
import { Notice } from '../../components/ui/notice';
import { SkeletonRows } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/states';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { useBusiness } from './context';
import { bizPath } from '../../lib/links';

/** Concept picker (feature 8): you choose the design direction from three, rather than a scoring rubric. */
export function ConceptsTab() {
  const { slug } = useBusiness();
  const q = useConcepts(slug);
  if (q.error) return <ErrorState error={q.error} what="concepts" />;
  if (!q.data) return <SkeletonRows rows={3} />;
  if (!q.data.concepts.length) return <Empty icon={Lightbulb}>Concepts appear here once the agent writes them. The build pauses so you can choose one.</Empty>;
  return <ConceptPicker slug={slug} set={q.data} />;
}

function ConceptPicker({ slug, set }: { slug: string; set: ConceptSet }) {
  const readOnly = !set.waiting && !!set.chosen;
  const [selected, setSelected] = useState<number | null>(readOnly ? set.chosen?.index ?? null : null);
  const [note, setNote] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenNote, setRegenNote] = useState('');
  const [zoom, setZoom] = useState<{ url: string; label: string } | null>(null);
  const choose = useChooseConcept();
  const regen = useRegenerateConcepts();
  const guard = useAgentGuard();
  const toast = useToast();
  const navigate = useNavigate();
  const toProgress = () => navigate(bizPath(slug, 'progress'));

  const done = (r: JobOk | undefined) => {
    if (!r) return;
    toast({ kind: r.ok ? 'ok' : 'error', text: r.message });
    if (r.ok && r.job) toProgress();
  };
  const pick = async (index: number | null) => done(await guard('Continue the build', (override) => choose.mutateAsync({ slug, index, note: index === null ? undefined : note.trim() || undefined, override })));
  const regenerate = async () => {
    const job = await guard('Write three new concepts', (override) => regen.mutateAsync({ slug, note: regenNote.trim(), override }));
    if (job) { setRegenOpen(false); setRegenNote(''); toast({ kind: 'ok', text: 'Writing three new concepts' }); toProgress(); }
  };

  const onRadioKey = (e: React.KeyboardEvent, i: number) => {
    if (readOnly) return;
    const n = set.concepts.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); const j = (i + 1) % n; setSelected(set.concepts[j].index); focusCard(set.concepts[j].index); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); const j = (i - 1 + n) % n; setSelected(set.concepts[j].index); focusCard(set.concepts[j].index); }
    else if (e.key === ' ' || e.key === 'Enter') { if (e.target === e.currentTarget) { e.preventDefault(); setSelected(set.concepts[i].index); } }
  };
  const focusCard = (index: number) => document.getElementById(`concept-${index}`)?.focus();
  const sel = set.concepts.find((c) => c.index === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {set.waiting ? (
        <Notice tone="warn" title="The build is waiting for you">Pick the direction the site should take. The agent builds the chosen concept, and your note goes with it.</Notice>
      ) : set.chosen ? (
        <Notice tone="ok" title={`Chosen: ${set.chosen.name}`}>{set.chosen.note ? <>Your note: “{set.chosen.note}”</> : 'No note was added.'}</Notice>
      ) : null}

      <div role="radiogroup" aria-label="Design concepts" aria-readonly={readOnly || undefined} className="grid gap-4 lg:grid-cols-3">
        {set.concepts.map((c, i) => {
          const isSel = selected === c.index;
          const focusable = readOnly ? -1 : (selected === null ? i === 0 : isSel) ? 0 : -1;
          return (
            <ConceptCard key={c.index} concept={c} selected={isSel} agentPick={set.agentPick === c.index} chosen={set.chosen?.index === c.index}
              tabIndex={focusable} readOnly={readOnly} onSelect={() => !readOnly && setSelected(c.index)} onKeyDown={(e) => onRadioKey(e, i)}
              onZoom={(url, label) => setZoom({ url, label })} />
          );
        })}
      </div>

      {!readOnly ? (
        <div className="glass flex flex-col gap-3 rounded-panel p-4 md:p-5">
          <label htmlFor="concept-note" className={cn('text-sm', sel ? 'text-fg-2' : 'text-fg-4')}>{sel ? `A note to go with ${sel.name}` : 'Select a concept to add a note'}</label>
          <textarea id="concept-note" rows={2} className="field" disabled={!sel} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: e.g. concept 2, but with concept 1's type" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setRegenOpen(true)}>None of these</Button>
            {set.agentPick !== null ? <Button variant="outline" loading={choose.isPending && choose.variables?.index === null} onClick={() => void pick(null)}>Let the agent's pick stand</Button> : null}
            <Button variant="primary" disabled={!sel} loading={choose.isPending && choose.variables?.index === selected} onClick={() => void pick(selected)}>Choose this concept</Button>
          </div>
        </div>
      ) : null}

      {set.mdUrl ? <div><ButtonA variant="link" size="sm" href={set.mdUrl}><FileText className="size-3.5" aria-hidden />Open concepts.md</ButtonA></div> : null}

      <Dialog open={regenOpen} onClose={() => setRegenOpen(false)} title="Ask for three new concepts"
        actions={<>
          <Button variant="ghost" onClick={() => setRegenOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!regenNote.trim()} loading={regen.isPending} onClick={() => void regenerate()}>Write new concepts</Button>
        </>}>
        <p>This starts an agent run. Say what's wrong with these three, so the next ones are different.</p>
        <label htmlFor="regen-note" className="sr-only">What's wrong with these concepts</label>
        <textarea id="regen-note" rows={3} className="field mt-3" value={regenNote} onChange={(e) => setRegenNote(e.target.value)} placeholder="e.g. all three feel too dark and formal for a family bakery" />
      </Dialog>

      <Dialog open={!!zoom} onClose={() => setZoom(null)} wide title={zoom?.label ?? ''} actions={<Button variant="outline" onClick={() => setZoom(null)}>Close</Button>}>
        {zoom ? <div className="max-h-[70vh] overflow-auto rounded-card bg-white/5"><img src={zoom.url} alt={zoom.label} className="mx-auto w-full" /></div> : null}
      </Dialog>
    </div>
  );
}

const SHOT_LABEL: Partial<Record<Device, string>> = { mobile: 'Phone', desktop: 'Desktop' };

function ConceptCard({ concept: c, selected, agentPick, chosen, tabIndex, readOnly, onSelect, onKeyDown, onZoom }: {
  concept: Concept; selected: boolean; agentPick: boolean; chosen: boolean; tabIndex: number; readOnly: boolean;
  onSelect: () => void; onKeyDown: (e: React.KeyboardEvent) => void; onZoom: (url: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shots = (['mobile', 'desktop'] as Device[]).filter((d) => c.shots[d]);
  return (
    <div id={`concept-${c.index}`} role="radio" aria-checked={selected} aria-label={`Concept ${c.index}: ${c.name}`} tabIndex={tabIndex}
      onClick={onSelect} onKeyDown={onKeyDown}
      className={cn('flex flex-col gap-4 rounded-panel p-5 outline-offset-2 transition-[border-color,background] duration-150', selected ? 'glass-lit' : 'glass', !readOnly && 'cursor-pointer hover:border-border')}>
      <div className="flex items-start justify-between gap-2">
        <span className="label">Concept {c.index}</span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {chosen ? <Chip dot="ok">Chosen</Chip> : null}
          {agentPick ? <Chip dot="info">Agent's pick</Chip> : null}
          {c.score !== null ? <Chip hollow title="The critic's score">{c.score.toFixed(1)} / 5</Chip> : null}
        </div>
      </div>
      <div>
        <h2 className="text-[26px] leading-tight font-light tracking-[-0.02em] text-fg">{c.name}</h2>
        {c.idea ? <p className="mt-2 text-sm text-fg-2">{c.idea}</p> : null}
      </div>
      {c.palette.length ? (
        <div className="flex items-center gap-1.5" aria-label={`Palette: ${c.palette.join(', ')}`}>
          {c.palette.map((hex) => <span key={hex} title={hex} className="size-6 rounded-full border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" style={{ background: hex }} />)}
        </div>
      ) : null}
      {shots.length ? (
        <div className="flex gap-2">
          {shots.map((d) => (
            <button key={d} type="button" onClick={(e) => { e.stopPropagation(); onZoom(c.shots[d]!, `${c.name}, ${SHOT_LABEL[d]?.toLowerCase()} mock-up`); }}
              className={cn('overflow-hidden rounded-[14px] border border-border-soft bg-white/5', d === 'mobile' ? 'w-[34%] shrink-0' : 'min-w-0 flex-1')}
              aria-label={`See the ${SHOT_LABEL[d]?.toLowerCase()} mock-up of ${c.name} full size`}>
              <img src={c.shots[d]} alt="" loading="lazy" className={cn('w-full object-cover object-top', d === 'mobile' ? 'aspect-[9/16]' : 'aspect-[4/3]')} />
            </button>
          ))}
        </div>
      ) : <p className="rounded-[14px] border border-dashed border-border-soft p-4 text-center text-xs text-fg-3">No mock-up for this concept.</p>}
      {c.body ? (
        <div>
          <button type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onKeyDown={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-sm text-fg-2 underline-offset-2 hover:text-fg hover:underline">
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />{open ? 'Hide the full concept' : 'Read the full concept'}
          </button>
          {open ? <div onClick={(e) => e.stopPropagation()}><Markdown text={c.body} className="mt-2 text-sm" /></div> : null}
        </div>
      ) : null}
    </div>
  );
}
