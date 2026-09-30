---
name: build
description: Build this business's website end to end from the gathered brand, facts and research. Six phases, bespoke result, gates must pass. Resumes from whatever is already in acta/. Run by the Acta pipeline or by hand.
---

# Build

You are building one website for one real business, from a blank page. The starter gives you plumbing (`src/kit/`), typed content (`src/content/site.ts`), tokens (`src/theme.ts`), routes with throwaway placeholder markup, and gates. It gives you no design. The design is yours, and it must be theirs.

Read `CLAUDE.md` first. Then work through the phases in order. Each phase leaves a file in `acta/` so the reasoning is visible and so a stopped build can continue.

## Where to start

Check what already exists and skip finished phases:

| Exists | Skip |
|---|---|
| `acta/research/board.md` has a `## Designer notes` section | phase 1 |
| `acta/brief.md` and `src/theme.ts` has no `#1f2937` primary | phase 2 |
| `src/content/site.ts` has no `TODO copywriter` | phase 3 |
| `src/components/` has files and no `PLACEHOLDER` comment remains under `src/app/` | phase 4 is at least started; read the build log if there is one and continue |
| `acta/qa/gate.json` has `"pass": true` | phase 5 |

## Budget

The whole build should reach phase 4 inside 25 turns and finish inside 120. Reading is cheap, thinking out loud is not. Do not re-read files you have already read. Do not narrate.

## Phase 1: look, briefly (append `## Designer notes` to `acta/research/board.md`)

1. Read `acta/brand.json`, `acta/facts.json`, and `acta/research/board.md`. Skim `acta/lead.json` for the audit of their current site only.
2. **Check the logo by eye.** Open `public/brand/logo.*` with Read, then each file in `public/brand/logo-candidates/` (`candidates.json` says where each came from). Pick the one that is this business's own logo at the best size: if a candidate is better than `logo.*`, copy it over `logo.*` and update `site.logo.path` and `alt` in `src/content/site.ts`. If none is theirs (Google review badge, supplier or accreditation mark, social icon, photo, stock icon), delete `logo.*`, set `logo` to `null` in `site.ts`, and the site gets a wordmark. Write one line about the decision in the notes. Never use a wrong logo.
3. Look at up to six photos in `public/brand/photos/` with Read. One line each: what it shows and where it could work. Skip the rest.
4. At most three `WebFetch` calls for references from land-book.com, siteinspire.com or godly.website, searched by the business type and mood. One line each. Zero is fine if the board already has references.
5. Append `## Designer notes` to `board.md`: the brand as found (one paragraph), what customers praise (one paragraph from the reviews), what the current site gets wrong (one paragraph, if there is one), the photo notes, the references, and three candidate directions in one sentence each. Under 60 lines. Commit.

Do not copy anything from any reference. Not text, not images, not a logo, not a distinctive illustration.

## Phase 2: brief and theme (delegate to the `designer` subagent)

Ask the designer to write `acta/brief.md` and fill `src/theme.ts` and `src/app/fonts.ts`. Read the brief when it returns. It must state, section by section, what the site is, and it must say what makes it unlike a generic site of this type. If it doesn't, send it back once with that instruction.

Run `pnpm typecheck` and `pnpm test`. The contrast test must pass on the new theme. Commit.

## Phase 3: content (delegate to the `copywriter` subagent)

Ask the copywriter to write `acta/content.md` and update `src/content/site.ts`. When it returns, check `site.ts` against `acta/facts.json` yourself: every accreditation, year, guarantee and "same day" claim must be in facts. Remove anything that isn't. No `TODO` may remain. Run `pnpm typecheck` and `pnpm test`. Commit.

## Phase 4: design and build

Write the site. Components go in `src/components/`, one file per section, named for what they are on this site (not "Hero1"). Replace the markup of every route under `src/app/` completely; remove every `PLACEHOLDER` comment. Keep each route's data flow (`site.ts` in, metadata out) and keep the contact form wired to `submitContact` with the honeypot field.

Requirements, all of them:
- Mobile first. Sticky call bar on phones with `tel:` (and WhatsApp when `site.business.whatsapp` is set).
- Their logo from `site.logo` in the header. No logo: a wordmark in the heading font, as the brief specifies.
- Their photos from `site.photos` in the hero and at least one other section, when they have any. No photos: use the brief's plan, never a random image from the web. Put named placeholders in `public/images/` with a `README.md` listing what is needed, and say so in the build log.
- Every service and area page designed, not just the home page. They share the theme, they are not clones of each other.
- Reviews rendered verbatim with first name and date.
- Opening hours, address and a map link in the footer or contact section, from `site.business`.
- Semantic HTML, real headings in order, focus visible (the kit handles focus styles), images with alt text, tap targets at least 44px on mobile.
- Use `next/image` for photos with sizes set, so Lighthouse performance stays above 90 on mobile.

Work in passes: structure, then type and spacing, then colour, then imagery, then motion. Run `pnpm typecheck` after each pass and `pnpm gate:fast` after the structure pass and again at the end. Commit after each pass.

## Phase 5: QA loop (up to three rounds)

1. `pnpm shots`.
2. Ask the `critic` subagent to check `acta/qa/*.png` against the brief. It returns a numbered list of fixes.
3. Fix everything on the list. Re-shoot. Ask again.
4. Stop when the critic says `No fixes.` or after three rounds.
5. `pnpm gate` (with Lighthouse). If a gate fails, fix it and run it again. You may not finish with a failing gate; the Stop hook will send you back.

## Phase 6: hand over

Write `acta/build-log.md`:
- The direction chosen and why, in three lines.
- Every decision that a reviewer might question (a colour shade adjusted for contrast, a photo cropped, a service merged, a logo rejected).
- What you could not resolve: missing logo, no photos, a claim you left out because facts didn't support it, a gate you had to work around.
- Timing: which phase took longest.

Commit everything: `feat: <business name> site`. Do not push. Stop.

## When things are missing

- No logo, or a wrong one: wordmark in the heading typeface, as the brief specifies. Note the upsell ("I can redraw your logo") in the build log.
- No photos: no stock is fetched. Named placeholders in `public/images/` with a README of what to shoot, and a layout that still works with them as flat colour blocks. Note it in the build log.
- No reviews: no reviews section. Do not invent testimonials.
- No accreditations in facts: the site says none. Do not hint.
- Pinterest research absent: proceed with gallery references only and say so in the notes.
