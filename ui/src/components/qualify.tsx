import { Check, X } from 'lucide-react';
import type { Qualify } from '../../../src/ui/api-types';
import { Dot, type DotTone } from './ui/chip';

type Verdict = Qualify['verdict'];
const TONE: Record<Verdict, DotTone> = { pass: 'ok', near: 'warn', fail: 'muted' };
const LABEL: Record<Verdict, string> = { pass: 'Passes', near: 'Near miss', fail: 'Fails' };
export const VERDICT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any gates' }, { value: 'pass', label: 'Passes' }, { value: 'pass,near', label: 'Passes or near miss' }, { value: 'near', label: 'Near misses' },
];

/** Whether a lead clears the gates in config/pick.yaml: a dot and words, its grade, and what it's missing on hover. */
export function VerdictChip({ verdict, grade, missing }: { verdict: Verdict; grade: number; missing: string | null }) {
  return (
    <span title={missing ? `Missing: ${missing}` : 'Clears every gate'} className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2">
      <Dot tone={TONE[verdict]} />{LABEL[verdict]}{verdict !== 'fail' ? <span className="text-fg-3">· {grade}</span> : null}
    </span>
  );
}

/** For a table: passes, near miss or fails with the grade, and underneath what stands in the way. */
export function GatesCell({ verdict, grade, gaps = [], missing }: { verdict: Verdict; grade: number; gaps?: string[]; missing: string | null }) {
  if (!verdict) return <span className="text-xs text-fg-4">—</span>;   // an older server, before gates
  return (
    <div className="min-w-0" title={missing ? `Missing: ${missing}` : 'Clears every gate'}>
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2">
        <Dot tone={TONE[verdict]} />{LABEL[verdict]}{verdict !== 'fail' ? <span className="text-fg-3 tabular-nums">· {grade}</span> : null}
      </span>
      {gaps.length ? <div className="truncate text-xs text-fg-3">{verdict === 'fail' && gaps.length > 1 ? `${gaps[0]} +${gaps.length - 1}` : gaps[0]}</div> : null}
    </div>
  );
}

/** Every gate with why it passed or failed, then the grade, part by part. */
export function QualifyPanel({ qualify }: { qualify: Qualify }) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-1.5 text-sm">
        {qualify.gates.map((g) => (
          <li key={g.key} className="flex items-start gap-2">
            {g.pass ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-label="passes" /> : <X className="mt-0.5 size-3.5 shrink-0 text-bad" aria-label="fails" />}
            <span className="min-w-0"><span className="text-fg">{g.label}</span> <span className="text-fg-3">· {g.detail}</span></span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <p className="label">Grade {qualify.grade} of 100</p>
        {qualify.parts.map((p) => (
          <div key={p.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-xs" title={p.detail}>
            <span className="truncate text-fg-2">{p.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-fg-2" style={{ width: `${(100 * p.points) / p.max}%` }} /></span>
            <span className="text-fg-3 tabular-nums">{p.points}/{p.max}</span>
            <span className="col-span-3 -mt-1.5 truncate text-fg-3">{p.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
