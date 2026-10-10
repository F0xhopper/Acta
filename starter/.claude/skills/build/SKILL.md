---
name: build
description: Build this business's website end to end from the gathered brand, facts and research. Eight phases, bespoke result, gates must pass. Resumes from whatever is already in acta/. Run by the Acta pipeline or by hand.
---

# Build

You are building one website for one real business, from a blank page. The starter gives you plumbing (`src/kit/`), typed content (`src/content/site.ts`), tokens (`src/theme.ts`), routes with throwaway placeholder markup, and gates. It gives you no design. The design is yours, and it must be theirs, and it must stand next to the craft references in `acta/research/` without embarrassment.

Read `CLAUDE.md` first. Then work through the phases in order. Each phase leaves a file in `acta/` so the reasoning is visible and so a stopped build can continue.

## Where to start

Check what already exists and skip finished phases:

| Exists | Skip |
|---|---|
| `acta/research/board.md` has a `## Designer notes` section | phase 1 |
| `acta/plan.md` has a `## Photo audit` section covering every photo | phase 2 |
| `acta/concepts.md` has a `## Chosen` section | phase 3 |
| `acta/brief.md` has a `Signature` section and `src/theme.ts` has no `#1f2937` primary | phase 4 |
| `src/content/site.ts` has no `TODO copywriter` | phase 5 |
| `src/components/` has files and no `PLACEHOLDER` comment remains under `src/app/` | phase 6 is at least started; read the build log if there is one and continue |
| `acta/qa/gate.json` has `"pass": true` | phase 7 |

## Pace

Take the time a good studio would. This is one bespoke site for one real business, not a template fill: expect two to three hours. Read what you need, look at every photo and every reference, think before you build. Do not narrate, and do not re-read files you already have, but never skip a phase to save time. Depth in research, planning and concepts is the point.

## Phase 1: research (append `## Designer notes` to `acta/research/board.md`)

1. Read `acta/brand.json`, `acta/facts.json`, and `acta/research/board.md`. Skim `acta/lead.json` for the audit of their current site only.
2. **Check the logo by eye.** Open `public/brand/logo.*` with Read, then each file in `public/brand/logo-candidates/` (`candidates.json` says where each came from). Pick the one that is this business's own logo at the best size: if a candidate is better than `logo.*`, copy it over `logo.*` and update `site.logo.path` and `alt` in `src/content/site.ts`. If none is theirs (Google review badge, supplier or accreditation mark, social icon, photo, stock icon), delete `logo.*`, set `logo` to `null` in `site.ts`, and the site gets a wordmark. Write one line about the decision in the notes. Never use a wrong logo.
3. Look at up to six photos in `public/brand/photos/` with Read. One line each: what it shows and where it could work. Skip the rest.
4. **References: craft sets the bar.** Read `acta/research/inspiration.md` and look at every screenshot it lists with Read. The craft references (`acta/research/craft/`) each have a phone shot, a desktop shot and a three-screen desktop scroll: look at all three, because the scroll shot shows the rhythm and the margins. Then the structure references (`acta/research/real-sites/`) and the galleries (`acta/research/galleries/`). To look closer at a site you spot in a gallery, open the gallery with `WebFetch`, then run `pnpm refs <url>` and Read the screenshots it saves in `acta/research/refs/`. Pick the mix the note gives: about five craft and three structure. One line each: for a craft reference, what its scale, space or composition does and how that transfers to this business; for a structure reference, which section order or first-screen idea it confirms. One reference from outside the trade is welcome (a barbershop can learn from a tailor).
5. Read `acta/research/previous-acta-sites.md`, including its "Do not reuse" list, and look at each previous hero screenshot it lists. Write one line on what this site must not repeat.
6. Append `## Designer notes` to `board.md`: the brand as found (one paragraph), what customers praise (one paragraph from the reviews), what the current site gets wrong (one paragraph, if there is one), the photo notes, the references, and three candidate directions in one sentence each. Under 60 lines. Commit.

Do not copy anything from any reference. Not text, not images, not a logo, not a distinctive illustration.

## Phase 2: plan (delegate to the `planner` subagent)

Ask the planner to write `acta/plan.md`. This is where the site is thought through: every page and section with its content and evidence, the photo audit, the gallery order, the features, the gaps. `acta/site-type.json` says what this kind of site must contain; the plan says what this business's site contains.

If `acta/curation.json` exists, the owner has already sorted the photos by hand. Those decisions are final: dropped photos have been moved to `acta/photos-dropped/` and must never be used, and its `hero` is the hero photo. The photo audit records them as decided by the owner.

Read the plan when it returns and check it: every route in `acta/site-type.json` is covered, every photo in `public/brand/photos/` has a row in the photo audit, the hero is a strong photo, nothing marked drop is used anywhere, and every section names its evidence. Send it back once if not. Commit.

## Phase 3: three concepts as pictures, then choose (designer, then critic)

If `acta/concepts-feedback.md` exists, the owner rejected earlier concepts: read it first, and make the new three answer it.

Ask the designer for `acta/concepts.md` and the three mock-ups `acta/concepts/concept-<n>.html`, as its instructions say: three genuinely different organising ideas, each described for a phone and for a desktop, each with a static mock-up of the hero and the first section. Then run `pnpm mockups` to screenshot the mock-ups on a phone and a desktop. Look at the six screenshots yourself: a mock-up that is a wireframe, or whose desktop is the phone layout stretched, goes back to the designer once.

Then ask the `critic` to score each concept from the screenshots, 1 to 5, on: fits the plan's goal, true to the brand and photos, craft, distinct from every site in `acta/research/previous-acta-sites.md`, distinct from local competitors, works on a phone. Append `## Scores` and `## Chosen`, with the winning concept and the reason, to `concepts.md`. A concept scoring under 3 on craft or on either distinctness cannot win. Commit.

**When the owner chooses.** If `acta/checkpoint.json` exists with `"concept": true`, the owner picks the concept, not the critic. Then append `## Scores` as above and `## Agent's pick` (not `## Chosen`) naming the winner as `Concept <n>` with the one reason, commit, and stop: end your turn without starting phase 4. The pipeline shows the mock-ups and asks the owner, who writes `## Chosen` (with an optional note you must follow). The next run resumes at phase 4.

## Craft: what a finished page must have

The references set the bar; these are the floor. The critic checks them on every screen.

- **Scale.** The hero headline on desktop is at least three times the body size (`theme.type.display` against `theme.type.body`). Headings have tight leading and real weight. Body text is never under 16px, and lines never run past the measure.
- **Rhythm.** The gap between sections on desktop is at least twice the gap on a phone (`theme.layout.section`). Margins on desktop are generous on purpose. Dead space, an empty band where nothing is composed, is a bug; so is a cramped block where everything touches.
- **Desktop is designed, not widened.** Every section has a desktop composition from the brief: columns, a dominant element, photos large. On desktop the hero photo fills the width or the height of the first screen, or the hero is deliberately type-only. A photo in a small box next to text is not a hero.
- **One dominant element per section.** Not everything is a card. Nothing is boxed for the sake of it. A list can be a list.
- **Photos carry the site.** Large enough to judge the work, cropped with intent, rendered with `next/image` and a real `sizes` attribute so they stay sharp and light.
- **Consistency.** One radius, one rule weight, one button shape, one accent, two families at most. Alignment holds from section to section.
- **The first screen sells.** On a phone, within one screen: what they do, where, proof, and a call or book action.

Use the scale from `src/theme.ts`: `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-small`, `text-eyebrow`, `px-gutter`, `py-section`, `max-w-container`, `max-w-measure` (or the CSS variables behind them). They are the designer's numbers for this business, fluid between a 390px phone and a 1440px desktop, so the site holds its proportions at every width.

## Motion: purposeful, never the point

Every site gets a little motion, chosen in the brief and applied in phase 6. Use it to show where to look and to make the site feel alive, not to impress:
- Allowed: content fading and rising slightly as it scrolls into view (once, 200 to 500 ms, staggered at most 80 ms), hover and press states on buttons and cards, a gentle image zoom on hover in galleries, a smooth open for menus and the lightbox, a subtle header change on scroll.
- Never: scroll-jacking, parallax that moves text, auto-playing carousels, cursor effects, animations longer than 600 ms, anything that delays the first view of the content or the call button, or anything that moves while someone is trying to read.
- Always: honour "reduce motion" (the `useReveal` hook in `src/kit/reveal.ts` does this for you), animate only `opacity` and `transform`, and keep Lighthouse performance above 90 on mobile.

## Phase 4: brief and theme (delegate to the `designer` subagent)

Ask the designer to write `acta/brief.md` and fill `src/theme.ts` and `src/app/fonts.ts` for the chosen concept, designing the plan: the brief decides how each planned section looks, not what it says. Read the brief when it returns. It must have the Signature block, it must give every section a composition at 390px and at 1440px, it must fill the type and layout scales in `theme.ts` with real numbers, and it must say what makes it unlike a generic site of this type and unlike each previous Acta site. If it doesn't, send it back once with that instruction.

Run `pnpm typecheck` and `pnpm test`. The contrast test must pass on the new theme. Commit.

## Phase 5: content (delegate to the `copywriter` subagent)

Ask the copywriter to write `acta/content.md` and update `src/content/site.ts`, section by section from the plan. Photos in `site.photos` are only the ones the plan keeps, in the plan's order. When it returns, check `site.ts` against `acta/facts.json` yourself: every accreditation, year, guarantee and "same day" claim must be in facts. Remove anything that isn't. No `TODO` may remain. Run `pnpm typecheck` and `pnpm test`. Commit.

## Phase 6: design and build

Build the plan as the brief composes it. Every page and section in `acta/plan.md` exists, in the planned order, with the planned photo, at both sizes the brief describes. Components go in `src/components/`, one file per section, named for what they are on this site (not "Hero1"). Replace the markup of every route under `src/app/` completely; remove every `PLACEHOLDER` comment. Keep each route's data flow (`site.ts` in, metadata out) and keep the contact form wired to `submitContact` with the honeypot field.

Requirements, all of them:
- Mobile first, desktop designed. Sticky call bar on phones with `tel:` (and WhatsApp when `site.business.whatsapp` is set).
- Their logo from `site.logo` in the header. No logo: a wordmark in the heading font, as the brief specifies.
- Their photos from `site.photos` in the hero and at least one other section, when they have any. No photos: use the brief's plan, never a random image from the web. Put named placeholders in `public/images/` with a `README.md` listing what is needed, and say so in the build log.
- Every service and area page designed, not just the home page. They share the theme, they are not clones of each other.
- Reviews rendered verbatim with first name and date.
- Opening hours, address and a map in the Find us or contact section, from `site.business`: use `MapEmbed` from `src/kit/map` (a tap-to-load facade, so it costs nothing until opened). Style the facade to the design.
- When the plan has `/gallery`: a designed portfolio grid in the plan's order with an accessible tap-to-enlarge lightbox (Escape closes, arrows move, focus returns), linked from the nav, the mobile menu, the footer and the home page's work strip.
- Every page except contact carries at least one real photo from the plan, when the plan keeps any.
- Semantic HTML, real headings in order, focus visible (the kit handles focus styles), images with alt text, tap targets at least 44px on mobile.
- Use `next/image` for photos with `sizes` set, so they are served light and stay sharp; the images gate measures what a phone is served.

Work in passes, and look at your own work between them:
1. **Structure**: every route, every section, the content in place. `pnpm typecheck`, `pnpm gate:fast`, commit.
2. **Type and spacing**: the scale from `theme.ts` applied, the measure held, the rhythm set. Commit.
3. **Desktop composition**: every section as the brief composes it at 1440px. Then `pnpm shots` and Read the desktop slices in `acta/qa/shots.md` for every page: fix anything that is the phone layout widened, any dead band, any small hero. Commit.
4. **Colour**, then **imagery** (crops, `sizes`, full-width and full-height photos where the brief says), then **motion**. `pnpm typecheck` after each, `pnpm gate:fast` at the end, commit after each pass.

## Phase 7: QA loop (up to three rounds)

1. `pnpm shots`. It writes one screen at a time for every key page on a phone and a desktop, listed in `acta/qa/shots.md`.
2. Ask the `critic` subagent to check the slices against the brief, the chosen concept and the craft floor: missing planned sections, dropped photos in use, weak photo choices, hierarchy, dead space, desktop composition, and whether the result still looks like the chosen concept rather than a generic site. It reads the previous Acta hero screenshots too, so it can say if this one resembles any of them. It returns a numbered list of fixes with the slice each one is seen in.
3. Fix everything on the list. Re-shoot. Ask again.
4. Stop when the critic says `No fixes.` or after three rounds.
5. `pnpm gate` (with Lighthouse). If a gate fails, fix it and run it again. You may not finish with a failing gate; the Stop hook will send you back.

## Phase 8: hand over

Write `acta/build-log.md`:
- The concept chosen, the two rejected and why, in five lines.
- Every decision that a reviewer might question (a colour shade adjusted for contrast, a photo cropped, a service merged, a logo rejected).
- The plan's content gaps, as questions for the owner.
- What you could not resolve: missing logo, no photos, a claim you left out because facts didn't support it, a gate you had to work around.
- Timing: which phase took longest.

Commit everything: `feat: <business name> site`. Do not push. Stop.

## When things are missing

- No logo, or a wrong one: wordmark in the heading typeface, as the brief specifies. Note the upsell ("I can redraw your logo") in the build log.
- No photos: no stock is fetched. Named placeholders in `public/images/` with a README of what to shoot, and a layout that still works with them as flat colour blocks. Note it in the build log.
- No reviews: no reviews section. Do not invent testimonials.
- No accreditations in facts: the site says none. Do not hint.
- Pinterest research absent: proceed with the craft and structure references and say so in the notes.
