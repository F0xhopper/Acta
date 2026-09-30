---
name: revise
description: Apply a reviewer's note to this site, re-check it, and hand it back. Used after a human rejects a preview with a note.
---

# Revise

1. Read `acta/review-notes.md`. The last entry is the note to act on. Read `acta/brief.md` and `acta/build-log.md` for context.
2. Decide what the note touches: look and feel (delegate to the `designer` subagent for a brief amendment, then implement), words (delegate to the `copywriter`), facts (only `acta/facts.json` may change what the site says; if the note asserts a fact that is not in facts.json, do not add it, record that in the build log for the human), or a bug (fix it).
3. Implement the change. Keep everything else as it was; a revise is not a rebuild.
4. `pnpm typecheck`, `pnpm shots`, then ask the `critic` subagent to check the screenshots against the brief and the note. Fix what it lists. Up to two rounds.
5. `pnpm gate`. All gates must pass.
6. Append to `acta/build-log.md`: the note, what you changed, anything you could not do and why.
7. Commit: `fix: <what the note asked for>`. Do not push. Stop.
