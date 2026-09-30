# Phase one: building the sites

The plan for turning a shortlisted lead into a reviewed, live preview site with one command. Each site is its own git repo, built by a Claude Code agent following a fixed process with a bespoke result, and checked by scripts the agent cannot skip.

Companion to [PIPELINE.md](PIPELINE.md) (the whole design) and [PLAYBOOK.md](PLAYBOOK.md) (the manual version this replaces).

---

## 1. The shape of it

```
 leaderboard ──► pick ──► acta build <slug>
                            │
                            ├─ 1. create repo from the starter template, drop in the lead's facts
                            ├─ 2. run the /build skill headlessly in that repo
                            │      research ─► brief ─► content ─► build ─► QA loop
                            ├─ 3. gates (scripts, not the agent): Lighthouse, links, alt, facts, claims
                            ├─ 4. deploy to its own Vercel project, alias to <slug>.preview.acta.agency, noindex
                            ├─ 5. evidence: their site vs the new one on a phone, with scores
                            └─ 6. status: preview_ready, pitch pack updated with the link and the picture
                                        │
                              you review on your phone (two minutes)
                                        │
                              approve ─► outreach (phase two)   ·   send back with a note ─► /revise
```

Three repos are involved:

| Repo | What it is | Changes how often |
|---|---|---|
| `Acta` (this one) | The pipeline. Finds leads, orchestrates builds, tracks status. | Weekly |
| `acta-site-starter` | GitHub template every site starts from: Next.js, Tailwind, the block library, `CLAUDE.md`, the skills, the gate scripts. | Every ten builds, after the retro |
| `acta-kit` | npm package of the plumbing that must stay consistent and that the agent never edits: SEO helpers, LocalBusiness schema, contact form handling, image pipeline, analytics, preview noindex. | Rarely |
| `site-<slug>` (one per lead) | The site. Created from the starter, owned by the agent, then by the customer. | Built once, then edits on request |

Why per-site repos and not a monorepo: a customer can be handed their repo, a bespoke site can diverge as far as it likes, a broken build can't touch any other site, and Vercel's one-project-per-repo model just works. What it costs: fixes don't propagate by themselves. The kit package solves that for plumbing, and a `/kit-sync` skill offers upstream block changes to sites that haven't modified them.

---

## 2. The starter template

`acta-site-starter` is a GitHub template repo. `gh repo create --template` stamps a fresh copy in seconds.

```
acta-site-starter/
  CLAUDE.md                  what the agent needs to know: stack, conventions, the rules, how to run checks
  .claude/
    settings.json            permissions and hooks (see section 6)
    skills/
      build/SKILL.md         the six-phase process
      revise/SKILL.md        act on a reviewer note, re-run gates, redeploy
      research/SKILL.md      refresh a vertical's inspiration board (interactive, uses Chrome)
      kit-sync/SKILL.md      pull upstream block changes the site hasn't touched
    agents/
      designer.md            turns research into the brief
      copywriter.md          writes the content, runs the claims check on itself
      critic.md              compares screenshots to the brief and lists concrete fixes
  acta/
    lead.json                filled by the pipeline: listing, audit, reviews, description, must-haves, competitors
    brief.md                 written by the agent in phase two
    content.md               phase three
    research/                screenshots and notes gathered for this lead
    qa/                      gate reports, screenshots, evidence composite
    build-log.md             the agent's decisions, for the retro
  src/
    app/                     Next.js App Router: home, one route per service, one per area, contact
    blocks/                  the visual building blocks the agent composes and adapts (owned by the site)
    content/                 site.ts: every fact and every line of copy, typed. Nothing hard-coded in components.
    lib/                     thin wrappers over @acta/kit
  public/images/             the licensed stock set chosen for this site
  scripts/
    gate.ts                  runs every check, writes acta/qa/gate.json, exits non-zero on failure
    shots.ts                 Playwright screenshots at phone, tablet, desktop
    evidence.ts              before/after composite with Lighthouse scores
  vercel.ts                  noindex header and robots disallow while ACTA_PREVIEW=1
```

**Blocks, not templates.** `src/blocks/` holds around thirty pieces: four hero variants, service grid, service detail, area section, review carousel, trust strip, gallery, opening hours, map, contact form, sticky call bar, FAQ, pricing table, team, footer. Each is a plain component with props, styled with tokens from `src/theme.ts`. The agent composes them, changes them, or writes new ones. The starter is the floor, not the ceiling.

**Facts live in one file.** `src/content/site.ts` is generated from `acta/lead.json` and holds name, phone, address, hours, rating, reviews, services, areas. Components read from it. The claims gate diffs the built HTML against it, so a component cannot invent a phone number or a "Gas Safe registered" the lead doesn't have.

**Images.** A curated, licensed library lives in `acta-kit/assets/<vertical>/`, tagged. Unsplash and Pexels licences allow commercial use. The agent picks a set for the brief. Their own photos come after they pay. Logo is text, in the brief's typeface.

---

## 3. The `/build` skill: six phases

The skill is prose the agent follows. Each phase writes its artefact into `acta/` so you can see why it did what it did.

### Phase one: research

Three sources, in this order, all saved to `acta/research/`.

1. **The vertical's inspiration board.** `research/<category>/` in this repo, refreshed by you monthly with the interactive `/research` skill (see section 4). Contains ten to twenty Pinterest pins as screenshots with one-line notes, five gallery references, and a palette and type direction. The agent reads it, it does not rebuild it.
2. **Local competitors with good sites.** From the leads database: the five same-category businesses in Birmingham whose audit came back live with Lighthouse over 80 and viability over 60. Fetched with Playwright, no login needed. The agent notes sections, tone, calls to action, what they do well, what they get wrong.
3. **The lead itself.** Reviews (what customers praise), the description, the audit (what's broken on their current site, if any), their current site's screenshots.

### Phase two: brief

The `designer` subagent writes `acta/brief.md`: layout direction, palette from the theme tokens, type pairing, imagery style and the chosen image set, section list in order, tone of voice, the three references that fit this business best, and an avoid list. This is the document you'd give a freelancer. It is also the yardstick the critic uses in phase five.

### Phase three: content

The `copywriter` subagent writes `acta/content.md` and then `src/content/site.ts`. Every service gets a page. Every named area gets a page. The copy uses what reviewers actually praise. Facts come from `lead.json` only. The copywriter runs the claims check on its own output before handing over.

### Phase four: build

The agent composes the site from blocks, adapts them to the brief, and writes bespoke sections where the brief calls for them. It runs `pnpm typecheck`, `pnpm build` and `pnpm shots` as it goes.

### Phase five: QA loop

Up to three rounds. The `critic` subagent looks at the three screenshots next to the brief's references and lists concrete fixes, not opinions: "hero text is unreadable on the photo at 390px", "call button is below the fold on mobile", "section order doesn't match the brief". The agent fixes and re-shoots. Then `pnpm gate` runs. If a gate fails, one more round, then stop and report.

### Phase six: hand over

The agent writes `acta/build-log.md` (what it chose and why, what it couldn't resolve), commits, and exits with a structured result. It does not deploy. The pipeline does.

---

## 4. Pinterest and inspiration, honestly

Pinterest has no public search API, and the Claude in Chrome extension needs your logged-in browser open. So per-lead Pinterest research in a headless build isn't possible, and wouldn't be worth it anyway. Ten leads in the same vertical want the same board.

The plan: **inspiration is gathered per vertical, interactively, once a month.** You run `/research barber` in a Claude Code session with Chrome connected. The skill searches Pinterest for the vertical ("barber website design", "barbershop landing page", "dark moody barber branding"), scrolls at human pace, screenshots ten to twenty pins, notes what recurs, then pulls five references from Land-book, Godly and SiteInspire, and writes `research/barber/board.md` with a palette and type direction. Twenty minutes per vertical. The headless build reads the board and never touches Pinterest.

References from galleries and competitor sites can be fetched headlessly, so those refresh per lead.

**What inspiration means here:** layout, hierarchy, palette, mood, section ideas. Never copy, images or brand assets. The `CLAUDE.md` says so and the gates can't catch it, so the critic checks for it explicitly.

---

## 5. Gates: what the agent cannot skip

`scripts/gate.ts` runs on the production build and writes `acta/qa/gate.json`. A Stop hook in the starter runs it whenever the agent tries to finish, and blocks the finish if it fails. The pipeline reads the JSON too, so a site never deploys on the agent's say-so.

| Gate | Pass condition |
|---|---|
| Lighthouse mobile | performance 90 or above, SEO 95 or above, accessibility 90 or above |
| Links | every internal link resolves, every external link returns under 400 |
| Images | every image has alt text, none over 300 KB, hero under 150 KB |
| Facts | name, phone, address, hours in the HTML match `lead.json` exactly |
| Claims | no phrase from the claims list (Gas Safe, NICEIC, "years experience", "award-winning", "fully insured", "DBS checked") unless it appears in `lead.json` evidence |
| Reach | `tel:` and WhatsApp links present, contact form posts, sitemap and robots correct |
| Preview | noindex header present when `ACTA_PREVIEW=1` |
| Originality | no run of twelve or more words shared with any competitor page fetched in research |

---

## 6. Claude Code, done properly

- **`CLAUDE.md` in the starter** carries the rules the agent must never break: facts from `lead.json` only, no copying, no invented claims, licensed images only, run the gates, keep every line of copy in `site.ts`. Short, specific, tested by reading it as if you were new.
- **Skills** hold process, not rules. They can be long. The build skill is written after the first five sites are built by hand with the agent, distilled from the notes of what you had to correct. Not before.
- **Subagents** (`designer`, `copywriter`, `critic`) keep the brief, the copy and the criticism honest by separating the roles. Each has its own tools and model setting in its frontmatter. The critic gets a cheaper, faster model. The designer gets the strongest one.
- **Hooks** in `.claude/settings.json`: a Stop hook that runs the gates and refuses to let the agent finish on a failure, and a PostToolUse hook on file writes that runs typecheck so errors surface immediately.
- **Permissions** in the same file: allow `pnpm`, `node scripts/*`, `git add` and `git commit`, deny `git push`, `rm -rf`, and any network call outside the research allowlist. Headless runs add `--allowedTools` to match.
- **Headless invocation** from the pipeline:

  ```
  claude -p "/build" --output-format json --max-turns 150
  ```

  The JSON result carries the exit status, turn count and the agent's final report. The pipeline stores it against the build. A wall-clock cap of an hour kills anything runaway.
- **Retro every ten builds.** Read the ten `build-log.md` files. Anything the agent wrote bespoke three or more times becomes a starter block. Anything you corrected twice becomes a line in `CLAUDE.md` or the skill. The skill-creator skill can run evals of the build skill against saved logs when it's worth the effort.

---

## 7. The orchestrator: `acta build`

New commands in this repo.

```
pnpm pipeline pick <slug> [<slug> ...]          # mark for building
pnpm pipeline build --picked [--max 5]           # build everything marked, in order of score
pnpm pipeline build <slug>                       # one lead
pnpm pipeline review                             # queue of preview_ready sites with links and the evidence image
pnpm pipeline approve <slug>                     # ready for outreach
pnpm pipeline reject <slug> --note "..."         # sends the note to /revise, rebuilds, back to review
```

What `build` does for one lead:

1. `gh repo create F0xhopper/site-<slug> --template F0xhopper/acta-site-starter --private --clone` into `sites/<slug>`.
2. Writes `acta/lead.json` from the database: listing, audit, reviews, description, must-haves, and the five competitor URLs for research.
3. Runs the headless build with the caps above. Status `building`.
4. Reads `acta/qa/gate.json`. On failure: status `build_failed`, reason stored, you see it in the review queue.
5. `vercel link` to a new project `site-<slug>`, `vercel deploy --prod` with `ACTA_PREVIEW=1`, `vercel domains add <slug>.preview.acta.agency`. Preview URL stored.
6. `scripts/evidence.ts`: their current site and the preview side by side on a phone frame, Lighthouse scores under each. Saved into the pitch pack.
7. Status `preview_ready`. The pitch pack's draft email now has the real link. Leaderboard refreshes.

New table `builds`: lead_id, repo_url, preview_url, vercel_project, status, attempts, gate_json_path, last_error, built_at, reviewed_at, review_note. Pipeline statuses gain `build_failed` and `approved`.

Wildcard DNS `*.preview.acta.agency` points at Vercel once. Each site project claims its own subdomain. When someone pays, their domain is added to the same project and `ACTA_PREVIEW` is switched off.

---

## 8. Where the human sits

Three settings, in order of autonomy.

| Setting | Pick | Build | Review before send | Send |
|---|---|---|---|---|
| **A. Supervised** | you | agent | you | you |
| **B. Mostly autonomous** | rule | agent | you | you (phase two: agent drafts, you approve) |
| **C. Full auto** | rule | agent | agent | agent, email channel only |

The auto-pick rule for B: tier A, twenty or more reviews, a review in the last twelve months, a category with a research board, not already built, capped at ten a week and two per category so you don't flood one high street with your own previews.

**Recommendation: start on A, move to B, keep the review gate for good.**

- The first ten builds are for teaching the skill, so pick them yourself and watch. Choose varied verticals. Read the build logs. Every correction you make is a line for `CLAUDE.md` or the skill.
- Once the agent goes three builds in a row without a correction, switch on the auto-pick rule and let it build a batch overnight. Your morning is the review queue.
- The two-minute review before anything is sent should stay permanently. It is the only step where a person checks what will be said in your name to a real business. The gates catch what can be measured. They cannot catch a site that is technically perfect and slightly embarrassing. The cost is two minutes per site, and it is the cheapest insurance you will ever buy.
- C is worth considering only for the email channel, after fifty sends with no complaint and a conversion rate you're happy with. Even then, sample-check one in five.

---

## 9. Sequence

Roughly two working weeks. Each milestone ends with something you can see.

| # | Milestone | Done when | Est. |
|---|---|---|---|
| 1 | Kit and starter | `acta-kit` published, `acta-site-starter` builds clean, gates run, `CLAUDE.md` written. Deploy the empty starter to a preview subdomain to prove the Vercel path. | 2 days |
| 2 | First site by hand | Open the starter for one real tier A lead in Claude Code, build it interactively with the agent, get it live at `<slug>.preview.acta.agency`. Time it. Note every correction. | 1 day |
| 3 | Research boards | `/research` skill working with Chrome. Boards for your first three verticals. | Half a day |
| 4 | Four more by hand | Same as 2, different verticals. Keep the notes. | 2 days |
| 5 | The build skill | Written from the notes. Run interactively on three fresh leads. Fix the skill, not the site, when it goes wrong. | 2 days |
| 6 | Orchestrator | `pick`, `build`, `review`, `approve`, `reject` working end to end headlessly on one lead. Evidence image in the pack. | 2 days |
| 7 | First batch | Five leads built overnight on setting A. Review in the morning. Retro. | 1 day |
| 8 | Auto-pick | Rule in place, weekly batch, setting B. | Half a day |

Don't build the orchestrator before the skill works interactively. Don't write the skill before five sites exist. Every shortcut here costs a week later.

---

## 10. Costs and limits

| Item | Cost |
|---|---|
| Vercel Pro | About £16 a month. Needed because previews are commercial. One project per site, no per-project fee at this scale. |
| GitHub private repos | Free. |
| Agent time | Twenty to forty-five minutes of headless Claude Code per site on your subscription. A batch of ten overnight is comfortably inside a Max plan's daily allowance, but watch it the first week. |
| Domain | `acta.agency` registered, wildcard DNS for previews. |
| Stock images | Free under Unsplash and Pexels licences. Curate once per vertical. |

---

## 11. What stays out of scope until phase two

Sending anything. Follow-ups. The CRM view. Payment links, domain transfer, handover docs. Phase one ends at "a reviewed preview and a pitch pack with the link and the picture". The playbook still covers the send until the outreach stage is built.
