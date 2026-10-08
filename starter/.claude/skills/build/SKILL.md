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
| `acta/plan.md` has a `## Photo audit` section covering every photo | phase 2 |
| `acta/concepts.md` has a `## Chosen` section | phase 3 |
| `acta/brief.md` and `src/theme.ts` has no `#1f2937` primary | phase 4 |
| `src/content/site.ts` has no `TODO copywriter` | phase 5 |
| `src/components/` has files and no `PLACEHOLDER` comment remains under `src/app/` | phase 6 is at least started; read the build log if there is one and continue |
| `acta/qa/gate.json` has `"pass": true` | phase 7 |

## Pace

Take the time a good studio would. This is one bespoke site for one real business, not a template fill: expect two to three hours. Read what you need, look at every photo, think before you build. Do not narrate, and do not re-read files you already have, but never skip a phase to save time. Depth in research, planning and concepts is the point.

## Phase 1: research (append `## Designer notes` to `acta/research/board.md`)

1. Read `acta/brand.json`, `acta/facts.json`, and `acta/research/board.md`. Skim `acta/lead.json` for the audit of their current site only.
2. **Check the logo by eye.** Open `public/brand/logo.*` with Read, then each file in `public/brand/logo-candidates/` (`candidates.json` says where each came from). Pick the one that is this business's own logo at the best size: if a candidate is better than `logo.*`, copy it over `logo.*` and update `site.logo.path` and `alt` in `src/content/site.ts`. If none is theirs (Google review badge, supplier or accreditation mark, social icon, photo, stock icon), delete `logo.*`, set `logo` to `null` in `site.ts`, and the site gets a wordmark. Write one line about the decision in the notes. Never use a wrong logo.
3. Look at up to six photos in `public/brand/photos/` with Read. One line each: what it shows and where it could work. Skip the rest.
4. Gather six to eight references with `WebFetch` from land-book.com, siteinspire.com, godly.website, minimal.gallery and httpster.net, searched by the business type, the site type's goal and the brand's mood. Prefer references from outside this trade too: a barbershop can learn from a record shop or a tailor. One line each: what the layout does, what the type does, what idea could transfer.
5. Read `acta/research/previous-acta-sites.md` and look at each previous hero screenshot it lists. Write one line on what this site must not repeat.
6. Append `## Designer notes` to `board.md`: the brand as found (one paragraph), what customers praise (one paragraph from the reviews), what the current site gets wrong (one paragraph, if there is one), the photo notes, the references, and three candidate directions in one sentence each. Under 60 lines. Commit.

Do not copy anything from any reference. Not text, not images, not a logo, not a distinctive illustration.

## Phase 2: plan (delegate to the `planner` subagent)

Ask the planner to write `acta/plan.md`. This is where the site is thought through: every page and section with its content and evidence, the photo audit, the gallery order, the features, the gaps. `acta/site-type.json` says what this kind of site must contain; the plan says what this business's site contains.

If `acta/curation.json` exists, the owner has already sorted the photos by hand. Those decisions are final: dropped photos have been moved to `acta/photos-dropped/` and must never be used, and its `hero` is the hero photo. The photo audit records them as decided by the owner.

Read the plan when it returns and check it: every route in `acta/site-type.json` is covered, every photo in `public/brand/photos/` has a row in the photo audit, the hero is a strong photo, nothing marked drop is used anywhere, and every section names its evidence. Send it back once if not. Commit.

## Phase 3: three concepts, then choose (designer, then critic)

If `acta/concepts-feedback.md` exists, the owner rejected earlier concepts: read it first, and make the new three answer it.

Ask the designer for `acta/concepts.md`: three genuinely different concepts for this business, each built on the plan. Different means a different organising idea, not three colourways. Give each concept its own heading in exactly this form: `## Concept 1: <Name>`, `## Concept 2: <Name>`, `## Concept 3: <Name>`. Put each concept's colours in the text as hex values. For each concept:
- **Name and idea** in one line (for example "the window sign": the site reads like the shop's signage).
- **Why it fits this business**, grounded in the reviews, the photos and the place.
- **References** it draws on from the board (pins and galleries), and what exactly it borrows.
- **Hero, gallery and one service page** described in enough detail to picture them on a 390px phone.
- **Type and colour use** within the brand.
- **Risk**: what could make it generic or wrong.

Then ask the `critic` to score each concept 1 to 5 on: fits the plan's goal, true to the brand and photos, distinct from every site in `acta/research/previous-acta-sites.md`, distinct from local competitors, works on a phone. Append `## Scores` and `## Chosen`, with the winning concept and the reason, to `concepts.md`. A concept scoring under 3 on distinctness cannot win. Commit.

**When the owner chooses.** If `acta/checkpoint.json` exists with `"concept": true`, the owner picks the concept, not the critic. Then:
1. Append `## Scores` as above, and `## Agent's pick` (not `## Chosen`) naming the winner as `Concept <n>` with the one reason.
2. Ask the designer for one static mock-up per concept at `acta/concepts/concept-<n>.html`: the home page hero and the first section after it, as that concept would build them, in one self-contained HTML file with inline CSS and no JavaScript. Use the real logo and real photos by relative path (`../../public/brand/...`) and the concept's type and colours; a Google Fonts link is fine. It must look like the concept, not a wireframe, and work at 390px and 1440px wide.
3. Commit, then stop and end your turn. Do not start phase 4. The pipeline screenshots the mock-ups and asks the owner, who writes `## Chosen` (with an optional note you must follow). The next run resumes at phase 4.

## Phase 4: brief and theme (delegate to the `designer` subagent)

Ask the designer to write `acta/brief.md` and fill `src/theme.ts` and `src/app/fonts.ts` for the chosen concept, designing the plan: the brief decides how each planned section looks, not what it says. Read the brief when it returns. It must state, section by section, what the site is, and it must say what makes it unlike a generic site of this type. If it doesn't, send it back once with that instruction.

Run `pnpm typecheck` and `pnpm test`. The contrast test must pass on the new theme. Commit.

## Phase 5: content (delegate to the `copywriter` subagent)

Ask the copywriter to write `acta/content.md` and update `src/content/site.ts`, section by section from the plan. Photos in `site.photos` are only the ones the plan keeps, in the plan's order. When it returns, check `site.ts` against `acta/facts.json` yourself: every accreditation, year, guarantee and "same day" claim must be in facts. Remove anything that isn't. No `TODO` may remain. Run `pnpm typecheck` and `pnpm test`. Commit.

## Phase 6: design and build

Build the plan. Every page and section in `acta/plan.md` exists, in the planned order, with the planned photo. Components go in `src/components/`, one file per section, named for what they are on this site (not "Hero1"). Replace the markup of every route under `src/app/` completely; remove every `PLACEHOLDER` comment. Keep each route's data flow (`site.ts` in, metadata out) and keep the contact form wired to `submitContact` with the honeypot field.

Requirements, all of them:
- Mobile first. Sticky call bar on phones with `tel:` (and WhatsApp when `site.business.whatsapp` is set).
- Their logo from `site.logo` in the header. No logo: a wordmark in the heading font, as the brief specifies.
- Their photos from `site.photos` in the hero and at least one other section, when they have any. No photos: use the brief's plan, never a random image from the web. Put named placeholders in `public/images/` with a `README.md` listing what is needed, and say so in the build log.
- Every service and area page designed, not just the home page. They share the theme, they are not clones of each other.
- Reviews rendered verbatim with first name and date.
- Opening hours, address and a map in the Find us or contact section, from `site.business`: use `MapEmbed` from `src/kit/map` (a tap-to-load facade, so it costs nothing until opened). Style the facade to the design.
- When the plan has `/gallery`: a designed portfolio grid in the plan's order with an accessible tap-to-enlarge lightbox (Escape closes, arrows move, focus returns), linked from the nav, the mobile menu, the footer and the home page's work strip.
- Every page except contact carries at least one real photo from the plan, when the plan keeps any.
- Semantic HTML, real headings in order, focus visible (the kit handles focus styles), images with alt text, tap targets at least 44px on mobile.
- Use `next/image` for photos with sizes set, so Lighthouse performance stays above 90 on mobile.

Work in passes: structure, then type and spacing, then colour, then imagery, then motion. Run `pnpm typecheck` after each pass and `pnpm gate:fast` after the structure pass and again at the end. Commit after each pass.

## Phase 7: QA loop (up to four rounds)

1. `pnpm shots`.
2. Ask the `critic` subagent to check `acta/qa/*.png` against the plan, the chosen concept and the brief: missing planned sections, dropped photos in use, weak photo choices, hierarchy, and whether the result still looks like the chosen concept rather than a generic site. Include the previous Acta hero screenshots so it can say if this one resembles any of them. It returns a numbered list of fixes.
3. Fix everything on the list. Re-shoot. Ask again.
4. Stop when the critic says `No fixes.` or after four rounds.
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
- Pinterest research absent: proceed with gallery references only and say so in the notes.
