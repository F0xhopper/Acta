import type { ContentItem, ContentLevel, ContentSummary } from '../../../src/ui/api-types';
import { Dot, type DotTone } from './ui/chip';

export const CONTENT_TONE: Record<ContentLevel, DotTone> = { plenty: 'ok', some: 'warn', little: 'bad' };
const SHORT: Record<ContentLevel, string> = { plenty: 'Plenty', some: 'Some', little: 'Little' };
const HAVE_TONE: Record<ContentItem['have'], DotTone> = { yes: 'ok', some: 'warn', no: 'bad' };
const HAVE_WORD: Record<ContentItem['have'], string> = { yes: 'Have', some: 'Some', no: 'Missing' };

/** What there is to build from, as a small chip: a dot, a word and the score, with the full list on hover. */
export function ContentChip({ content, long }: { content: ContentSummary; long?: boolean }) {
  return (
    <span title={content.summary} className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2">
      <Dot tone={CONTENT_TONE[content.level]} />{long ? content.label : SHORT[content.level]}<span className="text-fg-4">{content.score}</span>
    </span>
  );
}

/** Each piece of content: have it, some, or missing, and where it comes from. */
export function ContentList({ items, makeUp }: { items: ContentItem[]; makeUp: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border-soft">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-3 py-2">
            <span className="pt-1.5"><Dot tone={HAVE_TONE[i.have]} label={HAVE_WORD[i.have]} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{i.label} <span className="text-xs text-fg-3">· {HAVE_WORD[i.have]}</span></p>
              <p className="text-xs text-fg-3">{i.detail}</p>
            </div>
            <span className="shrink-0 text-xs text-fg-4">{i.points}/{i.max}</span>
          </li>
        ))}
      </ul>
      {makeUp.length ? (
        <div>
          <p className="text-xs text-fg-3">The site would make up</p>
          <ul className="mt-1 flex flex-col gap-1">{makeUp.map((m) => <li key={m} className="flex gap-2 text-sm text-fg-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-fg-3" />{m}</li>)}</ul>
        </div>
      ) : <p className="text-sm text-fg-2">Nothing important would need making up.</p>}
    </div>
  );
}
