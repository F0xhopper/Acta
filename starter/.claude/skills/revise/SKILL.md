---
name: revise
description: Apply a reviewer's note to this site, re-check it, and hand it back. Used after a human rejects a preview with a note.
---

# Revise

1. Read `acta/review-notes.md`. The last entry is the note to act on. Read `acta/brief.md` and `acta/build-log.md` for context.
2. Decide what the note touches: look and feel (delegate to the `designer` subagent for a brief amendment, then implement), words (delegate to the `copywriter`), facts (only `acta/facts.json` may change what the site says; if the note asserts a fact that is not in facts.json, do not add it, record that in the build log for the human), or a bug (fix it).
3. Implement the change. Keep everything else as it was; a revise is not a rebuild. If `acta/curation.json` exists, the owner's photo choices still hold: never bring back a photo it drops. Notes may include cropped images in `acta/review/round-<n>/`: open each with Read before changing anything.
4. `pnpm typecheck`, `pnpm shots`, then ask the `critic` subagent to check the slices in `acta/qa/shots.md` against the brief, the craft floor and the note. Fix what it lists. Up to two rounds. If the note is about the design signature (type, ground, hero composition), update the Signature block in `acta/brief.md` and `src/theme.ts` so they describe the site as it now is.
5. `pnpm gate`. All gates must pass.
6. Append to `acta/build-log.md`: the note, what you changed, anything you could not do and why.
7. Commit: `fix: <what the note asked for>`. Do not push. Stop.
