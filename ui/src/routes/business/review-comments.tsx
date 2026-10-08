import { ChevronDown, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BuildDetail, FeedbackItem } from '../../../../src/ui/api-types';
import { useDeleteFeedback, useUpdateFeedback } from '../../api';
import { Button } from '../../components/ui/button';
import { Chip, Dot } from '../../components/ui/chip';
import { useToast } from '../../components/ui/toast';
import { cn } from '../../lib/cn';
import { PinMark } from './pin-canvas';
import { DEVICE_SIZE } from './review-live';

export const pageLabel = (build: BuildDetail, path: string | null) => (path === null ? 'Whole site' : build.pages.find((p) => p.path === path)?.label ?? path);

/** One unsent comment: number, where, editable text, rule checkbox, delete. */
function CommentRow({ item, n, build, selected, onSelect }: { item: FeedbackItem; n: number; build: BuildDetail; selected: boolean; onSelect: () => void }) {
  const update = useUpdateFeedback();
  const del = useDeleteFeedback();
  const toast = useToast();
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  const commit = () => { if (text.trim() && text.trim() !== item.text) update.mutate({ id: item.id, patch: { text: text.trim() } }); else setText(item.text); };
  return (
    <li className={cn('rounded-card border p-3 transition-colors', selected ? 'border-border bg-white/[0.07]' : 'border-border-soft')}>
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-2 text-left text-xs text-fg-3">
        {item.page !== null ? <PinMark n={n} selected={selected} className="size-5 text-[10px]" /> : <span className="grid size-5 place-items-center rounded-full border border-border text-[10px] text-fg-2">{n}</span>}
        <span className="truncate">{pageLabel(build, item.page)}{item.device ? ` · ${DEVICE_SIZE[item.device].label}` : ''}</span>
      </button>
      <label className="sr-only" htmlFor={`fb-${item.id}`}>Comment {n}</label>
      <textarea id={`fb-${item.id}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} className="field mt-2" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-fg-2">
          <input type="checkbox" checked={item.rule} onChange={(e) => update.mutate({ id: item.id, patch: { rule: e.target.checked } })} /> Also a pipeline rule
        </label>
        <Button size="icon-sm" variant="ghost" aria-label={`Delete comment ${n}`} loading={del.isPending}
          onClick={() => del.mutate(item.id, { onError: (e) => toast({ kind: 'error', text: `Couldn't delete: ${e.message}` }) })}><Trash2 className="size-3.5" /></Button>
      </div>
    </li>
  );
}

/** The side panel: unsent comments, a general note, gates, the two questions, and sent rounds. */
export function CommentsPanel({ build, unsent, numbers, selectedId, onSelect, onGeneral, generalBusy }: {
  build: BuildDetail; unsent: FeedbackItem[]; numbers: Map<number, number>; selectedId: number | null; onSelect: (f: FeedbackItem) => void;
  onGeneral: (text: string) => Promise<void>; generalBusy: boolean;
}) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const sent = build.feedback.filter((f) => f.round !== null);
  const rounds = [...new Set(sent.map((f) => f.round as number))].sort((a, b) => b - a);
  const gates = build.gates ?? [];
  const failing = gates.filter((g) => !g.pass);

  return (
    <div className="flex flex-col gap-4">
      <section className="glass rounded-panel p-4" aria-labelledby="comments-h">
        <h2 id="comments-h" className="text-sm font-medium">Your comments <span className="font-normal text-fg-3">· {unsent.length}</span></h2>
        {unsent.length ? (
          <ol className="mt-3 flex flex-col gap-2">
            {unsent.map((f) => <CommentRow key={f.id} item={f} n={numbers.get(f.id) ?? 0} build={build} selected={selectedId === f.id} onSelect={() => onSelect(f)} />)}
          </ol>
        ) : <p className="mt-2 text-sm text-fg-3">Click anywhere on the screenshot to leave a comment. When you're done, press Request changes.</p>}
        <form className="mt-3 flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await onGeneral(note.trim()); setNote(''); }}>
          <label htmlFor="general-note" className="label">About the whole site</label>
          <textarea id="general-note" rows={2} className="field" placeholder="A comment about the whole site" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" className="self-end" loading={generalBusy} disabled={!note.trim()}>Add note</Button>
        </form>
      </section>

      <section className="glass rounded-panel p-4" aria-label="Checks">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-fg-2">Gates</span>
          {gates.length ? <Chip dot={failing.length ? 'bad' : 'ok'}>{gates.length - failing.length} pass · {failing.length} fail</Chip> : <span className="text-xs text-fg-3">Not run</span>}
        </div>
        {failing.length ? <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-3">{failing.map((g) => <li key={g.name} className="flex items-center gap-1.5"><Dot tone="bad" />{g.name}{g.value !== undefined && g.value !== null ? ` (${g.value})` : ''}</li>)}</ul> : null}
        <p className="mt-3 border-t border-border-soft pt-3 text-sm text-fg">Is it them? Is it good?</p>
        <p className="mt-0.5 text-xs text-fg-3">Their brand, their photos, their facts, and a site you'd be proud to pitch.</p>
      </section>

      {rounds.length ? (
        <section className="glass rounded-panel">
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-sm">
            <span>Sent rounds <span className="text-fg-3">· {rounds.length}</span></span>
            <ChevronDown className={cn('size-4 text-fg-3 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          {open ? (
            <div className="flex flex-col gap-3 border-t border-border-soft px-4 py-3">
              {rounds.map((r) => (
                <div key={r}>
                  <p className="label">Round {r}</p>
                  <ul className="mt-1 flex flex-col gap-1.5 text-sm">
                    {sent.filter((f) => f.round === r).map((f) => (
                      <li key={f.id} className="flex items-start gap-2">
                        <Dot tone={f.resolved === 'fixed' ? 'ok' : f.resolved === 'not_fixed' ? 'bad' : 'muted'} className="mt-1.5" label={f.resolved === 'fixed' ? 'Fixed' : f.resolved === 'not_fixed' ? 'Not fixed' : 'Not checked'} />
                        <span className="min-w-0 text-fg-2"><span className="text-fg-3">{pageLabel(build, f.page)}: </span>{f.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
