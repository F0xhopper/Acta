@AGENTS.md

# This repo is an Acta site

One business, one site, designed from a blank page around that business's own brand. Everything below is a rule, not a preference.

## Where the truth lives
- `acta/facts.json` is the only source of facts. Name, phone, address, hours, services, accreditations, years, reviews. If it isn't in there, the site can't say it.
- `acta/brand.json` is the only source of brand. Logo, colours, fonts, photos. Use them.
- `acta/lead.json` is background about the business and its current site.
- `acta/site-type.json` says what this kind of site must contain: required pages, home sections, features. `acta/plan.md` (written in the planning phase) says what this business's site contains. Build the plan.
- All copy and facts the site renders live in `src/content/site.ts`, typed by `src/kit/site-schema.ts`. Components read from it. Nothing is hard-coded in a component.

## Never
- Edit anything under `src/kit/`. It is managed by Acta. That includes `src/kit/brand-images.tsx`, which generates the browser icon, the iPhone icon and the link preview shown when the site is shared.
- Copy text, images, logos or brand assets from any competitor, gallery, Pinterest pin or reference. Inspiration is layout, hierarchy, palette, mood. Nothing else.
- Use an image that is not in `public/brand/` (theirs) or `public/images/` with a `LICENSE.md` note saying where it came from and its licence.
- Invent a claim. No "Gas Safe", "fully insured", "20 years", "award-winning" unless `acta/facts.json` has it. The claims gate will fail the build.
- Leave placeholder markup. Every `PLACEHOLDER` comment in `src/app/**` must be gone. The starter's routes are unstyled scaffolding, not a design.
- `git push`. The pipeline pushes.

## Always
- Design for this business. It must not look like a generic site of its type, and must not look like another Acta site. Say in `acta/brief.md` what makes it different, and keep its `Signature` block true to the built site: the pipeline reads it.
- Design to the craft bar in `acta/research/` (see the build skill): a real type scale from `src/theme.ts`, generous rhythm, photos large, one dominant element per section, nothing boxed for the sake of it.
- Mobile first, desktop designed. Every section has a composition at 390px and at 1440px; a desktop that is the phone layout widened fails review. A sticky call bar on phones, and no second call button competing with it in the same view. `tel:` and WhatsApp links from `src/kit/phone.ts`.
- Motion is subtle and purposeful (see the build skill): honour reduced motion, animate only opacity and transform.
- One page per service and one per area, from `site.ts`, plus every required route in `acta/site-type.json` (a gallery for barbers, salons and other visual trades).
- A map on the Find us or contact section using `MapEmbed` from `src/kit/map`. Never a raw Google Maps iframe on page load.
- Only photos the plan keeps. A photo marked drop in `acta/plan.md` appears nowhere.
- Keep `src/theme.ts` and `src/app/fonts.ts` in agreement. Every colour pair you put text on must pass 4.5:1.
- Run `pnpm typecheck` after changes, `pnpm gate:fast` while iterating, `pnpm shots` to look at your work one screen at a time (`acta/qa/shots.md` lists the slices; never judge from the full-page images), and `pnpm gate` (with Lighthouse) before you finish.
- Write `acta/build-log.md`: what you decided, why, what you couldn't resolve.
- Commit with conventional messages as you go.

## Commands
`pnpm typecheck` · `pnpm test` · `pnpm gate:fast` · `pnpm gate` · `pnpm shots` · `pnpm mockups` · `pnpm refs <url>` · `pnpm e2e` · `pnpm build`
