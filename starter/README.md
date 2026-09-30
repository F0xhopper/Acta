# Acta site starter

The repo every Acta site starts from. It is infrastructure only. There is no design in here; the build agent creates one from the business's own brand, and every site is different.

## What is infrastructure (don't redesign)

- `src/kit/` managed plumbing: SEO metadata and LocalBusiness schema, contact form action with Resend delivery, preview noindex, unstyled accessibility primitives, phone helpers, contrast maths, the regulated-claims list, and a verbatim copy of the pipeline contracts. Never edited by the agent.
- `src/content/site.ts` typed content. The pipeline seeds facts; the copywriter fills copy.
- `src/theme.ts` and `src/app/fonts.ts` tokens and fonts. The designer fills them.
- `src/app/` routes: home, `/services/[slug]`, `/areas/[slug]`, `/about`, `/contact`, sitemap, robots, 404. Their markup is placeholder scaffolding and is replaced entirely by the design.
- `scripts/gate.ts` the gates. `scripts/shots.ts` screenshots. `scripts/stop-hook.mjs` the Claude Code Stop hook.
- `.claude/` the build and revise skills, the designer, copywriter and critic subagents, permissions and hooks.
- `.github/workflows/ci.yml` typecheck, unit tests, gates, e2e on every push.
- `acta/` what the pipeline puts in (`lead.json`, `brand.json`, `facts.json`, `research/`) and what the agent leaves behind (`brief.md`, `content.md`, `build-log.md`, `qa/`).

## What the agent writes

`src/components/**`, the markup of every route, `src/theme.ts`, `src/app/fonts.ts`, the copy in `site.ts`, and the `acta/*.md` record of its decisions.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | local dev server |
| `pnpm typecheck` | route types + tsc |
| `pnpm test` | unit tests (schema, seo, contrast, claims, contact) |
| `pnpm gate:fast` | build, start, all gates except Lighthouse |
| `pnpm gate` | the lot, including Lighthouse mobile. Writes `acta/qa/gate.json`, exits 1 on failure |
| `pnpm gate --url https://…` | gate a deployed site instead of building |
| `pnpm shots` | phone, tablet and desktop screenshots into `acta/qa/` |
| `pnpm e2e` | Playwright smoke and axe checks against the built site |

## Environment

| Variable | Effect |
|---|---|
| `ACTA_PREVIEW=1` | preview mode: `X-Robots-Tag: noindex`, robots disallow, `<meta robots noindex>`. Set at build time. Unset when the site goes live |
| `NEXT_PUBLIC_SITE_URL` | canonical URL for metadata and sitemap. Falls back to Vercel's production URL, then localhost |
| `RESEND_API_KEY`, `CONTACT_TO`, `CONTACT_FROM` | contact form delivery. Without them the form logs and still succeeds |

## Gates

lighthouse (perf 90, seo 95, a11y 90 on mobile) · links · images (alt, sizes, brand photos used) · facts (name, phone, postcode, service names present) · claims (regulated phrases need evidence in facts.json) · contrast (theme pairs at 4.5:1) · brand (logo used, primary colour present, heading font loaded) · reach (tel, WhatsApp, form) · preview (noindex only in preview) · sitemap.

Uniqueness against other Acta sites and originality against research pages are checked by the pipeline, not here.
