# Phase one: building the sites

Turning a shortlisted lead into a reviewed, live preview with one command. Every site is its own git repo and its own design. Nothing visual is shared between sites. What is shared is the plumbing, the rules and the checks.

The site is built around the business's own brand: their logo, their colours, their photos, every fact that can be found about them, and a design direction researched on Pinterest for that specific business.

Companion to [PIPELINE.md](PIPELINE.md) (the whole design) and [PLAYBOOK.md](PLAYBOOK.md) (the manual version this replaces).

---

## 1. The shape of it

```
 leaderboard ──► pick ──► acta build <slug>
                            │
                            ├─ 0. gather: everything findable about the business (script, not agent)
                            ├─ 1. stamp a repo from the starter (infrastructure only, no UI)
                            ├─ 2. run the /build skill headlessly in that repo
                            │      research (Pinterest, galleries, competitors, for this lead)
                            │      ─► brief + theme (their brand, extended)
                            │      ─► content (every fact with its source)
                            │      ─► design and build from a blank page
                            │      ─► QA loop with a critic
                            ├─ 3. gates (scripts): speed, links, facts, claims, contrast, brand, uniqueness
                            ├─ 4. deploy to its own Vercel project, <slug>.preview.acta.agency, noindex
                            ├─ 5. evidence: their site vs the new one on a phone, with scores
                            └─ 6. status preview_ready, pitch pack updated
                                        │
                              you review on your phone (two minutes: is it them, is it good)
                                        │
                              approve ─► outreach (phase two)   ·   send back with a note ─► /revise
```

| Repo | What it is |
|---|---|
| `Acta` (this one) | The pipeline. Finds leads, gathers the brand, orchestrates builds, tracks status. |
| `acta-site-starter` | GitHub template every site starts from. Infrastructure only: Next.js, Tailwind with an empty token file, `CLAUDE.md`, skills, subagents, gate scripts, deploy config. No components, no layouts, no colours. |
| `acta-kit` | npm package of plumbing the agent never edits: schema, contact form handling, image pipeline, sitemap, preview noindex, unstyled accessibility primitives (skip link, focus ring, form field wiring). |
| `site-<slug>` | One repo per site. Owned by the agent during the build, by the customer after. |

Why per-site repos: a customer can be handed theirs, a site can diverge as far as it likes, a broken build can't touch another site, and Vercel's one-project-per-repo model just works.

---

## 2. Gather: everything findable about the business

This runs before the agent, as deterministic code in the pipeline, and writes `acta/brand.json` and `acta/facts.json` into the new repo. It is the difference between a site that looks like theirs and a site that looks like anyone's.

### Sources, in order of trust

| Source | What we take | How |
|---|---|---|
| **Google listing** | name, phone, address, hours, rating, up to five dated reviews, type, attributes (wheelchair access, parking, card payments, kids, dogs), and up to ten photos, almost always uploaded by the owner | Places API. Already fetched for search; photos need one Place Details call per lead |
| **Their existing website**, when there is one | logo, brand colours, fonts, their own photos, services, about text, accreditations, years established, team names, social links, email | Playwright crawl of the homepage plus up to eight linked pages (about, services, contact, gallery) |
| **Companies House** | registered name, incorporation year, status | Already matched |
| **Facebook and Instagram** | profile picture (often the cleanest logo), bio, most recent post images | Links come from the site or the listing. Fetching needs a logged-in session, see section 4. Optional |
| **Street** | a Street View image of the premises for shops and salons | Street View Static API, display only |

### Brand extraction

- **Logo.** Candidates in priority order: the header or nav image, `apple-touch-icon`, `mask-icon`, `og:image` when it isn't a photo, the favicon, the social profile picture. Rejected: anything whose filename, alt or nearby text matches an accreditation or supplier badge (Gas Safe, Checkatrade, Worcester, Vaillant, NICEIC, Visa, Mastercard, Facebook, Google). The chosen file is trimmed, the background made transparent when it's a flat colour, and kept at its native resolution. SVG is kept as SVG. A raster under 200 px wide is flagged as low quality, which becomes an upsell line in the pitch: "I can redraw your logo properly".
- **Colours.** From three places, agreed by vote: CSS custom properties and the computed background and text colours of the header, buttons and links; the dominant colours of the logo; the dominant colours of their photos. Output is a primary, a secondary, an accent and a neutral, each with a hex and a note on where it came from. The designer extends these into a full scale in the brief.
- **Fonts.** Computed `font-family` of headings and body, and any Google Fonts link. If the face is a Google Font it's used. If it's a system face or a Wix-only face, the designer picks the nearest Google Font and says so.
- **Photos.** Every image on their site over 600 px wide that isn't a logo, icon or badge, plus the Google photos. Each is recorded with its source and its dimensions. The agent picks; the critic checks that at least the hero and one section use their real photos when any exist.
- **Tone.** Not extracted, inferred by the designer from the copy and the reviews: what customers praise, how the business talks about itself.

### Facts with evidence

`acta/facts.json` holds every claim we can make, each with a source and a quote:

```json
{ "claim": "Gas Safe registered", "source": "website", "url": "https://.../about", "quote": "We are Gas Safe registered (No. 512345)" }
{ "claim": "established 2011", "source": "companies_house", "quote": "Incorporated 14 March 2011" }
{ "claim": "same-day call-outs", "source": "review", "quote": "came out the same day", "author": "Dawn" }
```

The copywriter may only state what is in this file. The claims gate checks the built HTML against it. A business with no website and no accreditations gets a site that says less, and that's correct.

### Rights, in one paragraph

Previews are private, noindex, and shown only to the business they depict. Using their own logo and photos in a mock-up made for them is the point of the exercise, and if they say no, the repo and the deployment are deleted the same day. Google photos are displayed with attribution and are not kept past the preview, per Google's terms. When they say yes, they send their own files and the preview becomes their site.

**What no business has:** a site with no logo gets a wordmark set in the brief's typeface, and no photos gets licensed stock matched to the palette. Both are said plainly in the pitch, because both are upsells.

---

## 3. The starter: infrastructure only

```
acta-site-starter/
  CLAUDE.md                  the rules and how to run checks. No design guidance beyond "unique, theirs, fast"
  .claude/
    settings.json            permissions and hooks (section 6)
    skills/                  build, revise, research, kit-sync
    agents/                  designer, copywriter, critic
  acta/
    brand.json facts.json    written by gather
    research/                pins, references, competitor notes, for this lead
    brief.md theme.md        the design decisions
    content.md               the copy
    qa/                      gate reports, screenshots, evidence
    build-log.md             what the agent chose and why
  src/
    app/                     empty App Router shell: layout.tsx with fonts and metadata wired, nothing else
    theme.ts                 empty token file the designer fills: colours, type scale, spacing, radii
    content/site.ts          typed facts and copy, generated from facts.json and content.md
    components/              empty. The agent writes everything here
  public/brand/              logo and photos placed by gather
  scripts/                   gate.ts, shots.ts, evidence.ts, similarity.ts
  vercel.ts                  noindex header and robots disallow when ACTA_PREVIEW=1
```

There is deliberately no component library, no hero variant, no section catalogue. The agent starts from `theme.ts` and a blank `components/` folder every time. The kit gives it unstyled primitives for the fiddly accessible bits so it can't get those wrong, and nothing that looks like anything.

---

## 4. Research for this lead, including Pinterest

Per lead, not per vertical. The queries come from the brand, so a navy plumber and a neon barber get different boards.

1. **Pinterest.** Three to four searches built from the category, the palette and the mood, for example "plumber website design navy", "trades website hero photo dark", "modern barbershop landing page", "dark moody barber branding". Six to eight pins each, scrolled at human pace, screenshot with a one-line note: what the layout idea is, what the typography does, why it suits this business. Twenty minutes of browser time per lead.
2. **Galleries.** Five references from Land-book, Godly, SiteInspire and Minimal Gallery, fetched without login, filtered to the mood.
3. **Competitors.** The five best same-category sites in Birmingham from the leads database, to be different from, not to copy.
4. **Their current site**, if any, for what to keep (a colour customers know, a phrase they use) and what to drop.

**How Pinterest runs headlessly.** Pinterest has no public API and shows logged-out visitors a few pins and a login wall. The plan is a Playwright browser with a saved Pinterest session: you log in once in a visible browser, the session is stored locally, and headless builds reuse it, scrolling at human pace. If the session has expired the build falls back to the last board saved for that category and flags it in the build log, so a batch never dies on a login wall. Refresh the session monthly. For an interactive build, the Claude in Chrome extension in your own browser does the same job.

**What inspiration means.** Layout, hierarchy, palette, mood, section ideas, typographic voice. Never copy, images or brand assets from any reference. `CLAUDE.md` says so, the originality gate checks the text, and the critic checks the rest.

---

## 5. The `/build` skill

Six phases. Each writes its artefact to `acta/` so the reasoning is visible.

1. **Research.** As above. Output `acta/research/board.md` with the pins, references and competitor notes, each with a line on relevance.
2. **Brief and theme.** The `designer` subagent writes `brief.md`: a layout concept in words, section by section, with intent ("hero: full-bleed photo of the shop front, wordmark bottom left, one line, call button"), the imagery plan (which of their photos where, what stock fills the gaps), tone of voice, motion notes, an avoid list, and the three references that matter most. It also fills `theme.ts`: the extracted palette extended to a full scale with contrast checked, the type pairing, spacing and radius decisions. The brief must name what makes this site unlike the last five built, and the critic holds it to that.
3. **Content.** The `copywriter` writes `content.md` from `facts.json`, the reviews and the brief's tone. A page per service, a page per area served, about, contact. Every claim traceable. It runs the claims check on itself.
4. **Design and build.** The agent writes the components for this site. No catalogue to reach for, so it builds what the brief describes. It runs typecheck, build and screenshots as it goes.
5. **QA loop.** Up to three rounds. The `critic` looks at phone, tablet and desktop screenshots beside the brief's references and the brand, and lists concrete fixes: readability, hierarchy, whether it actually uses their colours and logo, whether the hero uses their photo, whether it looks like the last site. Then `pnpm gate`.
6. **Hand over.** `build-log.md`, commit, structured exit. The pipeline deploys, never the agent.

---

## 6. Gates the agent cannot skip

`scripts/gate.ts` runs on the production build and writes `acta/qa/gate.json`. A Stop hook runs it whenever the agent tries to finish and blocks on failure. The pipeline reads the file itself before deploying.

| Gate | Pass condition |
|---|---|
| Speed | Lighthouse mobile: performance 90+, SEO 95+, accessibility 90+ |
| Links | every internal link resolves, every external link answers under 400 |
| Images | alt text on all, none over 300 KB, hero under 150 KB, at least one of their own photos used when any exist |
| Facts | name, phone, address, hours in the HTML match the listing exactly |
| Claims | every claim phrase in the HTML appears in `facts.json` |
| Brand | logo file present in the header, primary colour used on at least one interactive element, theme fonts loaded |
| Contrast | every text and background pair in `theme.ts` passes WCAG AA |
| Uniqueness | perceptual hash of the mobile hero and the full mobile page differ from every other site Acta has built by more than a threshold. No two Acta sites look alike |
| Originality | no run of twelve or more words shared with any page fetched in research |
| Reach | `tel:` and WhatsApp links present, contact form posts, sitemap and robots correct |
| Preview | noindex header present when `ACTA_PREVIEW=1` |

---

## 7. Claude Code, done properly

- **`CLAUDE.md`** carries rules, not taste: facts from `facts.json` only, brand from `brand.json`, no copying, licensed or their own images only, run the gates, every line of copy in `site.ts`, write the build log. Short, tested by reading it cold.
- **Skills** carry process and can be long. The build skill is written after the first five sites are built by hand with the agent, from the notes of what you corrected. Not before.
- **Subagents** separate the roles: `designer` (strongest model, the brief and theme), `copywriter` (strong model, the copy and its own claims check), `critic` (fast model, screenshots against the brief, concrete fixes only). Each has its own tools and model in its frontmatter.
- **Hooks**: a Stop hook that runs the gates and refuses to let the agent finish on a failure; a PostToolUse hook on file writes that runs typecheck.
- **Permissions**: allow `pnpm`, `node scripts/*`, `git add`, `git commit`; deny `git push`, `rm -rf`, and network outside the research allowlist. Headless runs pass `--allowedTools` to match.
- **Headless**: `claude -p "/build" --output-format json --max-turns 200`, a wall-clock cap of ninety minutes, the JSON result stored against the build.
- **Retro every ten builds.** Read the build logs. Every correction you made twice becomes a rule. Every gate that never fires gets loosened. Nothing visual gets promoted into the starter, on purpose. What gets promoted is process: a better brief template, a sharper critic checklist, a new gather source.

---

## 8. The orchestrator: `acta build`

The full engineering design, with every command, the state machine, testing and security, is in [BUILD-PIPELINE.md](BUILD-PIPELINE.md).

```
pnpm pipeline pick <slug> [<slug> ...]
pnpm pipeline gather <slug>                      # brand and facts only, useful to inspect before a build
pnpm pipeline build --picked [--max 5]
pnpm pipeline build <slug>
pnpm pipeline review                             # queue: preview link, evidence image, logo and palette as found
pnpm pipeline approve <slug>
pnpm pipeline reject <slug> --note "..."         # goes to /revise, rebuilds, back to review
```

For one lead: gather → `gh repo create F0xhopper/site-<slug> --template F0xhopper/acta-site-starter --private --clone` → write `acta/*.json` and `public/brand/*` → headless build with caps, status `building` → read `gate.json`, on failure `build_failed` with the reason → `vercel link`, `vercel deploy --prod` with `ACTA_PREVIEW=1`, `vercel domains add <slug>.preview.acta.agency` → `evidence.ts` → status `preview_ready`, pitch pack gets the link, the picture, and the upsell lines gather produced (redraw the logo, replace stock with your photos).

New table `builds`: lead_id, repo_url, preview_url, vercel_project, status, attempts, gate_json_path, brand_json_path, last_error, built_at, reviewed_at, review_note. Statuses gain `gathered`, `build_failed`, `approved`.

Wildcard DNS `*.preview.acta.agency` points at Vercel once. When someone pays, their domain is added to the same project and the preview flag switched off.

---

## 9. Where the human sits

| Setting | Pick | Gather check | Build | Review before send | Send |
|---|---|---|---|---|---|
| **A. Supervised** | you | you | agent | you | you |
| **B. Mostly autonomous** | rule | agent | agent | you | you (phase two: agent drafts, you approve) |
| **C. Full auto** | rule | agent | agent | agent | agent, email channel only |

The review is two questions on your phone. **Is it them?** Right logo, right colours, their photos, nothing that belongs to a supplier. **Is it good?** Would you be proud to send it. The gates cover everything else.

The auto-pick rule for B: tier A, twenty or more reviews, a review in the last twelve months, not already built, capped at ten a week and two per category so you don't flood one high street with your own previews.

**Recommendation: start on A, move to B once the agent goes three builds without a correction, keep the review gate for good.** A wrong logo or a supplier's badge in the header would be embarrassing in a way no gate can measure, and it costs two minutes to catch.

---

## 10. Sequence

Roughly two and a half working weeks, in an order that matters.

| # | Milestone | Done when | Est. |
|---|---|---|---|
| 1 | Gather | `acta gather <slug>` produces brand.json, facts.json and a brand folder for twenty leads from the database. You check ten by eye: right logo, sensible colours, real photos, no badges. | 2 days |
| 2 | Kit and starter | `acta-kit` published, starter builds clean, gates run, deploys empty to a preview subdomain. | 1.5 days |
| 3 | First site by hand | One real tier A lead with a logo and photos, built interactively in Claude Code from the gathered brand, live at its preview subdomain. Note every correction. | 1 day |
| 4 | Pinterest session and research | Saved session working headlessly, `/research` produces a board for a lead. | Half a day |
| 5 | Four more by hand | Different verticals, one with no site at all (wordmark and stock path). | 2 days |
| 6 | The build skill | Written from the notes. Run interactively on three fresh leads. Fix the skill, not the site. | 2 days |
| 7 | Orchestrator | `pick`, `build`, `review`, `approve`, `reject` end to end headlessly on one lead. Uniqueness gate has five sites to compare against. | 2 days |
| 8 | First batch and retro | Five overnight on setting A. Review in the morning. Retro. | 1 day |
| 9 | Auto-pick | Rule on, weekly batch, setting B. | Half a day |

Gather comes first because everything downstream is only as good as what it finds. Don't write the skill before five sites exist. Don't automate before the skill works interactively.

---

## 11. Costs

| Item | Cost |
|---|---|
| Vercel Pro | About £16 a month. Previews are commercial use. |
| GitHub private repos | Free |
| Place Details with photos | One request per built lead, inside the free allowance at this volume |
| Agent time | Thirty to sixty minutes headless per site, longer than a templated build because it designs from scratch. Ten overnight sits inside a Max plan's allowance, but watch the first week. |
| Pinterest | Free. Automated browsing is against its terms; twenty pins per lead at human pace is the risk you're choosing. |
| Domain | `acta.agency` with wildcard DNS |

---

## 12. Out of scope until phase two

Sending anything, follow-ups, the CRM view, payment, domain transfer, handover. Phase one ends at a reviewed preview and a pitch pack with the link, the picture and the upsell lines.
