import type { Photo, PhotoChoice } from '../../../../src/ui/api-types';

/** The photo sorter's state, kept pure so it can be tested: a choice and an optional drop reason per photo path. */
export type Choice = 'keep' | 'drop' | 'hero' | null;
export interface SortState { choices: Record<string, Choice>; reasons: Record<string, string | null> }

export function initialSort(photos: Photo[]): SortState {
  const choices: Record<string, Choice> = {};
  const reasons: Record<string, string | null> = {};
  let hero = false;
  for (const p of photos) {
    let c = p.choice;
    if (c === 'hero') { if (hero) c = 'keep'; hero = true; }
    choices[p.path] = c;
    reasons[p.path] = c === 'drop' ? p.reason : null;
  }
  return { choices, reasons };
}

/** Set a photo's choice. Picking the current choice again clears it. There is one hero: a new hero demotes the old one to keep. */
export function setChoice(s: SortState, path: string, c: Exclude<Choice, null>): SortState {
  const next: Choice = s.choices[path] === c ? null : c;
  const choices = { ...s.choices };
  if (next === 'hero') for (const k of Object.keys(choices)) if (choices[k] === 'hero') choices[k] = 'keep';
  choices[path] = next;
  const reasons = { ...s.reasons };
  if (next !== 'drop') reasons[path] = null;
  return { choices, reasons };
}

export function setReason(s: SortState, path: string, reason: string): SortState {
  return { ...s, reasons: { ...s.reasons, [path]: s.reasons[path] === reason ? null : reason } };
}

/** Give every unsorted photo the same choice. */
export function sortRemaining(s: SortState, photos: Photo[], c: 'keep' | 'drop'): SortState {
  const choices = { ...s.choices };
  for (const p of photos) if (!choices[p.path]) choices[p.path] = c;
  return { ...s, choices };
}

export function counts(s: SortState, photos: Photo[]) {
  let kept = 0, dropped = 0, unsorted = 0, hero = 0;
  for (const p of photos) {
    const c = s.choices[p.path];
    if (c === 'keep') kept++; else if (c === 'hero') { kept++; hero++; } else if (c === 'drop') dropped++; else unsorted++;
  }
  return { kept, dropped, unsorted, hero };
}

/** What the server receives. Unsorted photos are kept. */
export function toChoices(s: SortState, photos: Photo[]): PhotoChoice[] {
  return photos.map((p) => {
    const c = s.choices[p.path] ?? 'keep';
    return { path: p.path, choice: c, reason: c === 'drop' ? s.reasons[p.path] ?? null : null };
  });
}
