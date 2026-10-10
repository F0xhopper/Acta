# Acta

*Acta non verba.* Deeds, not words.

## The goal

Acta is an end-to-end pipeline for a build-first web studio. Instead of pitching a local business and hoping they'll pay for a website, it builds the website first and then shows it to them with a price. The whole loop, from finding a business to sending the email, is meant to run with a human only at the two points that matter: choosing who to pitch, and replying when they answer.

The full flow:

```
 find businesses with no website or a bad one
   -> audit what they have (dead site, Facebook only, not mobile friendly, slow)
   -> score the opportunity and how likely they are to pay
   -> you pick the ones worth building
   -> research the vertical, competitors and modern design references
   -> build a bespoke, fast, mobile-first, SEO-ready site on a preview URL
   -> screenshot it next to their current site with Lighthouse scores
   -> draft the pitch in the right channel and send it, with your approval
   -> follow up twice, track replies, stop on any no
   -> on a yes: take payment, attach their domain, hand over, bill monthly
```

It starts in Birmingham, UK. Other towns are added as markets in `config/areas.yaml`, and a search by hand works anywhere with a Google Places listing.

## Where it is now: v1

v1 automates the first three stages and hands you a ranked shortlist with evidence. Building and outreach are still manual, using the scripts in [docs/PLAYBOOK.md](docs/PLAYBOOK.md). The design for the remaining stages, including the automated build agent and email sending, is in [docs/PIPELINE.md](docs/PIPELINE.md).

| Stage | v1 | Later |
|---|---|---|
| Discover, audit, score, shortlist, pitch packs | automated | |
| Pick who to build | you | you, always |
| Research, build, deploy preview, evidence | by hand, with the playbook | phase 1: build agent, planned in [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) and [docs/BUILD-PIPELINE.md](docs/BUILD-PIPELINE.md) |
| Draft and send outreach, follow-ups, CRM | by hand | phase 2: sends on your approval |
| Payment, domain, handover, monthly billing | by hand | phase 3 |
| Daily lead finding, ranked suggestions | automated (`pnpm pipeline leads`) | |
| Scheduled weekly runs, reporting | by hand | phase 4 |

One command runs v1 for a plain-English search:

```
pnpm pipeline run "plumbers in Erdington"
```

1. **Discover.** Google Places Text Search, up to three pages, with a per-run request budget and a seven-day cache. Also pulls the business type, Google's summary when there is one, and up to five reviews with dates. Filters to the target postcode area, drops closed businesses, dedups, flags chains. `--variants` adds each category's alternative search terms (for plumbers: heating engineer, boiler repair, gas engineer), which surfaces owner-operators the main word misses.
2. **Audit.** Classifies each website as none, social-only, directory-only, platform-only, down, broken or live. Every site that isn't a dead domain then gets a second opinion in a real phone browser, which also takes the screenshots. That catches three things a plain fetch gets wrong: builders like Wix that add their mobile setup with JavaScript, sites behind bot protection that block scripts but load for people, and Google listings that link to a dead inner page while the homepage works. Live sites get HTML checks on both versions (mobile viewport, builder, free-tier host, copyright year, schema, phone match) and Lighthouse mobile scores via PageSpeed Insights.
   A dead site is not a dead lead. Every down or broken site also gets two free lookups: RDAP, the registries' own record, says whether the domain is still registered, lapsing, or free to register again, and the Wayback Machine gives the last archived copy. The copy fills in the description and contact details, counts in the content score (a logo, services and words to build from, at a slight discount for age), and the build crawls it for the logo and photos instead of starting from nothing. The pitch leads with it: "your domain has expired, I can get it back for you". `pnpm pipeline rescue [--query "..."] [--force]` runs the lookups for leads audited before this existed.
3. **Entity.** Matches each business against Companies House. A high-confidence match means it's a limited company, which is the only case where UK law allows cold email. Everyone else gets phone, walk-in or DM.
4. **Score.** Opportunity (how much a site would help) and viability (active, reachable, likely to pay), combined into tiers A to X with plain-English reasons. A recent review counts as a sign the business is active. No review in two years counts against it.
5. **Describe.** Each lead gets a short description of what the business does: Google's summary if it has one, otherwise the business's own website description, otherwise its Google type plus the most specific line from a good review. The source is always shown.
6. **Shortlist and packs.** A Markdown table and CSV per run, a pool summary, and a folder per lead with screenshots, Lighthouse JSON, customer quotes and a draft pitch in the right channel.

## Setup

Node 22.13 or newer and pnpm.

```
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
cp config/offer.example.yaml config/offer.yaml
pnpm --dir ui install && pnpm ui:build
```

`config/offer.yaml` holds your name, phone, postal address and prices for the pitch emails. It stays on your machine (it's in `.gitignore`), like `.env`.

Fill in `.env`:

| Variable | Where from |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Cloud project with **Places API (New)** enabled |
| `GOOGLE_PSI_API_KEY` | Same project with **PageSpeed Insights API** enabled. Can be the same key |
| `COMPANIES_HOUSE_API_KEY` | A **Live** application on the Companies House developer hub. Test-environment keys only work against the sandbox |
| `PLACES_MAX_REQUESTS_PER_RUN` | Safety cap, default 30 |

Set a billing alert on the Google Cloud project. The request cap should keep you inside the free allowance, the alert is the backstop.

## Commands

```
pnpm pipeline run "cafes in Moseley"                 # the whole chain for one query
pnpm pipeline run "plumbers" --areas trades --pages 2  # one trade across an area group from config/areas.yaml
pnpm pipeline run "barbers" --areas "Bearwood, Harborne"   # or across a list you give it
pnpm pipeline run "plumbers in Erdington" --variants      # add heating engineer, boiler repair, gas engineer
pnpm pipeline run --file queries.example.txt         # one query per line
pnpm pipeline run "barbers in Kings Heath" --dry-run # plan the requests, make none

pnpm pipeline discover "cafes in Moseley" --pages 2
pnpm pipeline audit --query "cafes in Moseley" [--force] [--no-psi] [--no-screenshots]
pnpm pipeline entity --query "cafes in Moseley"
pnpm pipeline score [--query "..."]
pnpm pipeline shortlist --query "cafes in Moseley" --top 20 --tiers A,B
pnpm pipeline pack <slug> [--reviews]                # --reviews calls Place Details, higher-priced SKU
pnpm pipeline status <slug> contacted --note "called, texting link"
pnpm pipeline stats [--query "..."]
pnpm pipeline leaderboard [--top 50]
pnpm pipeline describe                                        # fill website descriptions for leads audited before this existed
pnpm pipeline category --query "..." --set personal_trainer   # fix leads whose search matched no category
```

Output lands in `out/`:

```
LEADERBOARD.md          start here: every lead across every search, ranked, with pitch cards,
                        in-progress leads, results, and which searches yield best
leaderboard.csv         same ranking for a spreadsheet
<date>-<query>/
  shortlist.md          one search: at a glance, "pitch these first" cards, full ranking, excluded leads
  shortlist.csv         same rows with hook, reasons and next step
  summary.md            funnel, top 5, website breakdown, why leads were excluded, what to do next
  leads/<slug>/         notes.md (links, hook, audit, must-haves, draft pitch), screenshots, lighthouse.json
```

Every table links the business to Google Maps, shows what the business does, links the website if it has one, the phone to a tap-to-call link, and each row to its pitch pack. Each lead gets a one-line hook you can say to the owner and a next step in the right channel.

The leaderboard refreshes on every `run`, `shortlist` and `status` change, so it's always the current to-do list. `pnpm pipeline leaderboard` regenerates it on demand.

Re-running a query updates listing data, skips audits fresher than 14 days, and never resets pipeline status. Anything you've marked contacted, won or lost stays off future shortlists. `lost` and `do_not_contact` also go on a suppression list.

## The UI

A local web app for the whole loop: what needs you, the pipeline board, leads, live builds, the review studio, before-and-after compare, and the pitch composer. It runs on your Mac only, with no login.

```
pnpm ui:build   # once, and after UI changes
pnpm ui         # http://127.0.0.1:4321
pnpm ui:dev     # while working on the UI: server plus hot reload on http://localhost:5173
```

Builds run start to finish and you review the finished site. Three optional pauses can be switched on in `config/build.yaml`: before anything is built, to call a business that can't be cold emailed (see below); after gathering, to sort the photos; and after the agent writes three concepts, to choose one. The same choices work from the terminal with `pnpm pipeline call <slug> yes|no`, `pnpm pipeline photos <slug>` and `pnpm pipeline concept <slug>`. Review comments flagged "also a pipeline rule" collect in `data/pipeline-rules.md`. The plan is in `docs/UI-PLAN.md`.

## Can you reach them? Checked before building

Every lead gets a reach level, shown in the Leads list (with a filter) and on each business's Overview:
**Can email** (a limited company with an email address), **Can message** (a mobile for WhatsApp after a call, or a social page), **Call only** (a landline) or **Visit only**. Emails and social links come from the business's own website during the audit. When that finds none, discovery (every `run` and the daily `leads` run) goes on to a short Claude search of the open web (booking and ordering sites, directories, local news) and keeps an address only after fetching the page again and seeing it there with the lead's phone number or postcode. Facebook, Instagram, Google Maps and Yell are never opened, because they forbid scraping; the Overview tab links to them so you can look by eye, and many small businesses only list their email on Facebook. The open-web search is a Claude run per lead, so it only runs where an email would unlock cold email: limited companies in trades worth 60 or more (`web_email` in `config/pick.yaml`). Building for a lead you can only call or visit asks first. If you find an email yourself (a Facebook page, a flyer), add it on the Overview tab or with `pnpm pipeline contact <slug> <email>`.

**The call before the build.** Cold email is only allowed to a limited company with an email. Everyone else gets a call or a visit anyway, so `checkpoints.call: true` in `config/build.yaml` makes it happen before the build instead of after: the pick stops at "Call them first", the Overview tab shows a thirty-second script ("I'd like to put a site together for you to look at, nothing to pay to see it; if I WhatsApp it over, would you have a look?") and two buttons. Yes starts the build and the preview goes out as something they asked for. No drops the pick, builds nothing, and puts them on the do-not-contact list. Leads that can be cold emailed never stop here. It is off by default; the nightly build job skips any pick waiting on a call.

```
pnpm pipeline reach [--refresh] [--tiers A,B]   # reach for every lead; --refresh re-reads their sites first
pnpm pipeline web-emails [slug] [--limit 20]    # the open-web email search on its own (it runs after every search; automation.web_email in config/build.yaml)
```

## Design inspiration

The research step collects references as screenshots in `acta/research/`. Craft sets the bar: a hand-picked list of studio-quality sites per site type in `config/inspiration.yaml`, each captured on a phone, on a desktop and as a three-screen desktop scroll so the designer sees real pages rather than thumbnails. Structure is the floor: real, highly rated businesses of the same trade in other UK cities (via Places, two cities per build) show which sections a visitor expects, never the look. Awwwards and One Page Love results are captured for browsing, and the agent can screenshot any site it finds with `pnpm refs <url>`. The build skill carries the craft floor (type scale, rhythm, desktop composition, photo size), `src/theme.ts` holds the site's own type and layout scale as fluid tokens, and the critic judges one screen at a time from `pnpm shots`. Motion is subtle by rule: fade and rise on scroll, hover states, always off for visitors who ask for reduced motion.

## Sending pitches and follow-ups

Settings are in `config/outreach.yaml`. Everything starts in the safest setting: you send by hand.

- **Transport.** `manual` (copy into your mail app, then Mark as sent), `test` (writes each email to `out/outbox/`, sends nothing), `proton` (sends through Proton Mail Bridge on this Mac) or `resend`. Bridge's username and password, or a Resend key, go in `.env` as `PROTON_BRIDGE_USER`, `PROTON_BRIDGE_PASSWORD` or `RESEND_API_KEY`.
- **Guards.** Acta only emails limited companies (PECR), never anyone on the do-not-contact list, never without your name, postal address and the opt-out line, and never before the sending domain's MX, SPF, DKIM and DMARC records pass. Pitches always need your click.
- **Warm-up.** A daily limit starts at three emails and rises by three a week, up to twenty.
- **Follow-ups.** Due on day 3 and day 8 after the pitch, three contacts at most. They appear in the Inbox; with `follow_ups.auto: true` and a sending transport, Acta sends email follow-ups itself on weekdays between 9 and 5, five minutes apart.
- **Replies.** With `replies.check: true`, Acta reads your inbox through Bridge every ten minutes. A reply moves the business to Replied and stops its follow-ups. "No thanks" or "unsubscribe" puts it on the do-not-contact list.

```
pnpm pipeline outreach status          # transport, today's limit, DNS, follow-ups due
pnpm pipeline outreach check           # the sending domain's MX, SPF, DKIM and DMARC
pnpm pipeline outreach followups [--send]
pnpm pipeline outreach replies
pnpm pipeline outreach opens           # how often each preview has been opened
pnpm pipeline outreach stats           # what's working: pitches by trade, channel and hook, with opens, replies, wins
```

### Did they look? Preview opens and what's working

"Opened but didn't reply" and "never opened" are different problems: the first is the offer, the second is reach. Each preview counts its own opens: on a preview the site carries a tiny beacon that, once per browser session, tells its own `/api/seen` route a person opened it, and the route adds one to a counter in a shared Upstash Redis. Playwright, Lighthouse, link-preview fetchers (WhatsApp, Facebook, Slack) and crawlers never count, and nothing about the visitor is kept. Put `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in `.env` (a free Upstash database from the Vercel Marketplace or upstash.com); every preview deployed after that gets them. Acta reads the counters back every ten minutes while the UI runs, and shows "Preview opened 3 times, last 2 days ago" on the Send tab.

Every pitch also records the hook it led with (no website, site down, slow on phones, cheap builder, looks unmaintained ...). `outreach stats`, and the "What's working" section under the pipeline board, break every pitch down by trade, channel and hook: pitched, opened, replied, won. Once there are enough pitches, that table says which leads bite.

## Building a site

The build stage is separate from discovery. Give it a business name or a lead slug and it goes end to end: gathers the brand and facts, creates a private GitHub repo from the starter, researches the design, has a Claude Code agent design and build the site from a blank page, runs the gates, pushes, deploys a preview to Vercel, and produces the before-and-after picture.

```
pnpm pipeline build "Fade it"                     # a business name; found in the database or looked up on Google
pnpm pipeline build kings-heath-barber-fade-it    # or a lead slug from a shortlist
pnpm pipeline build "Fade it" --sandbox           # no GitHub, no Vercel: everything stays under sites/
pnpm pipeline build "Fade it" --no-agent          # infrastructure only, to test the plumbing
pnpm pipeline build "Fade it" --dry-run           # show the steps it would run
pnpm pipeline gather "Fade it"                    # just the brand and facts, printed

pnpm pipeline builds                              # every build, its state, links and cost
pnpm pipeline review                              # previews waiting for your two-minute check
pnpm pipeline approve <slug>
pnpm pipeline reject <slug> --note "hero photo is a supplier's van, use the shop front"
pnpm pipeline teardown <slug> --yes
pnpm pipeline research --login                    # save a Pinterest session for headless design research
pnpm pipeline deploy-smoke                        # prove the Vercel path with a throwaway site, then remove it
```

What happens, in order. Each step is recorded in a builds table and a build can resume from where it stopped.

| Step | What | Where it lands |
|---|---|---|
| gather | Google photos and attributes, a crawl of their existing site for logo, colours, fonts, photos, services and accreditations, Companies House, reviews. Every claim with its source | `data/brand/<slug>/`, then `acta/brand.json` and `acta/facts.json` in the repo |
| repo | Copy of `starter/`, seeded with the brand, facts and a generated `src/content/site.ts`, committed, pushed to a new private repo `site-<slug>` (tagged `acta-preview`; a repo found public is made private again before the push, and `pnpm pipeline doctor` checks every site repo is private) | `sites/<slug>/`, GitHub |
| research | Pinterest searches built from the brand (with a saved session), competitor screenshots from the database, a board for the designer | `acta/research/board.md` |
| agent | `claude -p "/build"` in the repo with a clean environment and no tokens. Eight phases: research, plan, three concepts as mock-ups scored by the critic, brief and theme, content, design and build, QA loop one screen at a time, hand over | commits in the repo, `acta/brief.md`, `acta/build-log.md` |
| gate | The pipeline runs the site's gates itself: Lighthouse, links, images (weighed as served to a phone), facts, claims, contrast, brand, reach, preview, sitemap. Then a design-signature check against every other site built (heading family, ground and primary, hero composition): a sibling goes back for a revise | `acta/qa/gate.json` |
| push | Push main; CI in the repo runs the same checks on Linux | GitHub Actions |
| deploy | Vercel project, production deploy with `ACTA_PREVIEW=1` (noindex), subdomain, verified by fetch. Skipped cleanly when `VERCEL_TOKEN` isn't set | `https://<slug>.preview.acta.agency` |
| evidence | Their site and the new one side by side on a phone with Lighthouse scores | `acta/qa/compare.png`, the pitch pack |

The starter under `starter/` is infrastructure only: routes, metadata, schema, contact handling, the gate scripts, CI, the rules in `CLAUDE.md` and the build skill. No components, no layouts, no colours. Every site's design is written by the agent for that business.

Needs: the Claude Code CLI on this machine, `gh` logged in, and for deploys either `vercel login` on this machine or a `VERCEL_TOKEN` in `.env`. See `.env.example`.

**Deploys.** Each site becomes its own Vercel project, `site-<label>`, where the label is a short DNS-safe name like `kings-heath-oslo-s`. The pipeline sets the project's framework to Next.js and switches deployment protection to previews only, because Vercel's default puts a login wall on every `*.vercel.app` address including production, and a business owner has to be able to open the link. The preview is a production deployment with `ACTA_PREVIEW=1`, which adds the noindex header. With `PREVIEW_DOMAIN` set and `*.preview.<domain>` pointed at Vercel, the site is also attached to `<label>.preview.<domain>`; without it, the `<project>-<team>.vercel.app` address is used. `pnpm pipeline deploy-smoke` proves the whole path with a throwaway site and removes it. `pnpm pipeline build <slug> --from deploy` deploys a build that finished before deploys were set up. Previews are commercial use under Vercel's terms, so the team should be on Pro before real previews go out.

**Cost and limits.** The design agent runs on your Claude subscription by default. A full build is 100 to 200 turns and can use most of a session's allowance, and if the limit is hit the build pauses with the work committed. Run the same `build` command after the reset and it continues from the artefacts in `acta/`. To run builds without touching the subscription, set `ACTA_AGENT_API_KEY` in `.env` and they bill to the API instead, at roughly $5 to $15 per site.

## Running it automatically

The plan to host all of this on a server and run it end to end without the Mac is in [docs/CLOUD-PLAN.md](docs/CLOUD-PLAN.md).

**The autopilot (on).** With `automation.autopilot: true` in `config/build.yaml`, Acta runs itself while its server is up (`pnpm ui`, or the always-on job below). Every minute it carries on any build paused at the usage limit, runs the timetabled jobs (the lead search daily at 07:30, housekeeping on weekday mornings, the Sunday re-score), and when nothing is building it picks the best lead that passes every gate below and builds it. It stops starting builds when Claude usage reaches the limit (`ACTA_USAGE_STOP_PERCENT`, 70%), after `max_builds_per_day` builds, when two builds have failed in a day, and while `max_unreviewed` previews wait for your review; the limits and times are the `autopilot` section of `config/build.yaml`. You get a macOS notification when a site is ready to review or a build fails, and a push to your phone as well with `ACTA_NOTIFY_URL` in `.env` (an ntfy.sh topic URL). The switch is in the header of every page (the Autopilot pill: click it for the reason, the counts and Turn on / Turn off), in the Inbox panel, and in the terminal as `pnpm pipeline autopilot on|off`; all three take effect at once. Off stops it starting anything new: a build already running finishes (cancel it from Activity to stop it), and a build paused at the usage limit still carries on when usage resets. `pnpm pipeline autopilot` shows what it is doing and why. It picks one lead at a time, just before building it, with the auto-picker's rule and re-check, so `auto_pick` stays off. `pnpm pipeline schedule install` installs the server as an always-on launchd job (`com.acta.ui`) that runs whenever the Mac is on and comes back after a restart. A running build keeps the Mac from idle-sleeping (`caffeinate`); a closed lid still sleeps it, and the build carries on when it wakes. Stop a terminal `pnpm ui` once the job is installed, and use `pnpm ui:dev` with `--port` or after `launchctl unload`.

**Lead finding is on; picking is yours when the autopilot is off.** `config/build.yaml` (`automation`) has the switches. `sweep` (on) finds new leads every day. `auto_pick` (off) would pick a batch for you on Sunday. You pick from the Suggested list with the Pick button or `pnpm pipeline pick <slug>`. The Auto-find button on the Leads page flips `sweep`.

```
pnpm pipeline leads [--dry-run] [--once]   # the daily run: best searches, then audit, Companies House, score. Writes out/NEW-LEADS.md
pnpm pipeline searches [--top 30]          # every search the sweep could run, best first, with what it expects and why
pnpm pipeline suggest [--top 12] [--gates]  # leads that pass the gates by grade, then near misses; --gates shows each gate
pnpm pipeline doctor                       # every prerequisite, and whether the loop is allowed to run
pnpm pipeline sweep [--dry-run]            # the searches alone, without audit and scoring
pnpm pipeline pick --auto [--dry-run]      # the auto-picker, when switched on
pnpm pipeline pick <slug> [<slug>...] / unpick <slug>
pnpm pipeline call <slug> [yes|no] [--note "..."]   # the call before the build: print the script, or record the answer (checkpoints.call)
pnpm pipeline rescue [--query "..."] [--force]  # dead and broken sites: domain state (RDAP) and the archived copy (Wayback), for the pitch and the build
pnpm pipeline entity --medium               # re-check medium Companies House matches now that SIC codes can settle them
pnpm pipeline week [--dry-run]             # Sunday: re-audit, score, yields, leaderboard (and auto-pick if on). Writes out/REVIEW.md
pnpm pipeline build --picked --max 5       # overnight: build the picked queue in pick-score order
pnpm pipeline day                          # weekdays: tear down stale previews, refresh the leaderboard, list the review queue
pnpm pipeline autopilot [status|on|off]    # what the autopilot is doing and why; switch it on or off
pnpm pipeline schedule install             # autopilot on: the always-on server (com.acta.ui). Off: leads daily 07:30, week Sunday 22:00, builds Mon and Tue 01:00, day weekdays 09:15
pnpm pipeline schedule install --jobs leads   # just the daily lead run at 07:30, without the server
pnpm pipeline schedule status | uninstall
```

**Where it searches.** `config/areas.yaml` lists markets: a town or city with its centre, its postcode areas and its neighbourhoods in groups (`high_streets`, `trades`, `affluent`). Every category in `config/categories.yaml` is searched across its group (its `areas`, by default high streets for walk-in trades and suburbs for the rest) in every active market. That grid is the search space: 372 searches for Birmingham alone. To go somewhere new, add a market and set `active: true`. Coventry and Wolverhampton are in there, switched off. A search for anywhere not configured ("cafes in Didsbury, Manchester") still works by hand. It just has no location bias and no postcode filter.

**How it chooses.** It uses the opportunity map (`src/sweep/opportunity.ts`). It learns from every lead found so far how many good leads (ones that clear every gate but reach) each trade gives per ten found. It then works out how each area does compared with what its trades would predict, so an area searched for one trade only doesn't take that trade's credit. Both are pulled towards the average until there's enough evidence. A search's expected yield is the overall rate times its trade factor times its area factor, refined by its own record once it has run. Trades and areas with little evidence get an exploration bonus, so some of each run samples new ground. Re-runs count for 30 percent of a new search, because they mostly find businesses already known. Each run takes the best searches within the request budget (24 a day, about 720 a month; cached searches cost nothing). Plumbers, electricians, roofers, builders, landscapers and fitters are also searched under their alternative terms ("fencing contractor", "loft conversion"), which find the owner-operators the headline word misses. Each further search of the same trade or area in that run counts a little less, so one run covers several trades and streets. A search is due again after 42 days. One that stays under 1.0 good per ten for two runs is retired. Searches you run by hand count too. All the knobs are in `config/sweep.yaml`; `mode: list` goes back to a fixed list.

**Gates, then you pick.** A lead passes when it clears every gate in `config/pick.yaml` (`gates`):

| Gate | Passes when |
|---|---|
| Eligible | independent, trading, not on the suppression list (not tier X) |
| Pays for a site | the trade's value is 50 or more. Builds are the scarce resource, so a trade worth less (barbers 30, cafes 40, takeaways 20, estate agents 40) is a near miss rather than a pass and never displaces a roofer. The value is the learned one, so a trade that replies more than your average rises above the line on its own |
| Needs a site | no real website; a live one with opportunity 50 or more; or the buyer lane: a live site that shows its age (cheap builder, free-tier address, no viewport, no HTTPS, Lighthouse under 40, copyright three years old) in a trade worth 70 or more. That owner has paid for a site once already, which says more about paying again than having none does |
| Established | 15 or more reviews, rated 4.0 or more, and active. Under 30 reviews, active means a review in the last year. Above that the dates aren't trusted: Google returns the five most relevant reviews, not the newest, so a busy business can look dormant. At any size, reviews gained since the listing was first seen count as active (the daily sweep re-sees listings and keeps the count each time) |
| Reachable | somewhere to send the preview once they've said yes: an email (cold if a limited company, after a call if not), a mobile for WhatsApp, or a social page. Landline-only and visit-only leads are near misses. Set `reach: [cold_email]` to pass only leads you can email without a call |
| Enough to build from | content score 55 or more |

The leads that pass are ranked by a grade out of 100, and every part of it comes with a reason: how much a site would help (20; the buyer lane counts as at least 50), trade value (20), reputation (15: reviews, rating, activity), reach (15: cold email 100%, a mobile for a call then WhatsApp 70%, an email but call first 60%, a social page 40%, landline 20%), content (15) and whether they can pay (10: limited company, incorporated one to five years ago, a trade that pays for marketing, a busy business). Companies House gives both the entity and its age: a medium match (the name agrees, the registered office doesn't) becomes a confirmed limited company when the company's SIC codes say it does this trade (`sic` in `config/categories.yaml`); `pnpm pipeline entity --medium` re-checks old ones.

**Trade value learns from your pitches.** Each trade starts with a guess in `config/categories.yaml` (`trade_value`: what one job is worth, whether customers find them on Google rather than an app, whether they already have sites; roofers 95, fitters and landscapers 90, beauty 60, barbers 30, takeaways 20). Once a trade has pitches and anything has replied, its value moves towards its results: a trade replying more often than your average rises, one that never replies sinks, and after ten pitches (`trade.learn_weight` in `config/pick.yaml`) the results count as much as the guess. The learned value feeds the grade, the gate (so a trade that proves the guess wrong gets through) and the sweep. Each lead's Gates section shows the guess, the pitches and the value now.

The top of the Leads page lists the passers, then the near misses: leads one gate short, each saying what's missing (often "Limited company, no email found: check their Facebook page"). Fix that and it passes. Each lead's Overview tab shows every gate and the grade part by part, the leads table has a Gates column and filter, and `pnpm pipeline suggest --gates` prints the same. The daily sweep learns from the gates too: a search's yield is how many of its leads clear every gate but reach (an email can often be found later), each counted in proportion to its trade's value up to 75 (`trade.sweep_full_at`). A roofer counts fully and a barber 0.4, so the sweep leans towards good trades without dropping any.

**How the auto-picker chooses** (when on). It builds from passers only, with an audit under 30 days old. Picks are capped at ten a week, two per trade per area and one walk-in trade per area. Before it commits, it checks each pick again: the Google listing must still exist, the site is fetched once more, and it must still pass.

Everything the sweep and the picker decide is printed with a reason, and both have `--dry-run`. `week` refuses to start if `doctor` finds a required prerequisite missing. Dead and broken sites are re-audited monthly and live ones every two weeks, because a status change in either direction changes the lead.

## Getting good results

- **Narrow area, specific trade.** "Personal trainers in Kings Heath" beats "gym trainer coach birmingham". Whole-city searches hit Google's 60-result cap and return the biggest firms, who least need you.
- **Sweep, don't widen.** `--areas` turns one trade into one search per suburb. The groups in `config/areas.yaml` are tuned by vertical: `high_streets` for walk-in trades, `trades` for plumbers and builders, `affluent` for dentists, solicitors and estate agents. Twelve areas at two pages is 24 Places requests, inside the default cap of 30. If the cap is hit the sweep stops cleanly, and cached searches rerun free.
- **Use a word the config knows.** Categories decide the channel, the site must-haves and the "pays for marketing" bonus. There are 30, from plumbers to vets. If a search prints "no category matches", fix it without refetching: `pnpm pipeline category --query "..." --set <key>`.
- **Check the leaderboard's yield table.** It ranks every search by good leads per ten businesses found. Go back to the areas and trades at the top.
- **Trades in the affluent suburbs.** Tradespeople listed in Solihull, Knowle, Dorridge, Shirley, Sutton Coldfield and Harborne do bigger jobs; those are in the `trades` group now. The first hand searches there produced most of the early passers.
- **Learn from what comes back, not from the guess.** Every pitch records its hook (no website, site down, slow site ...), channel and trade, and each preview counts its opens. `pnpm pipeline outreach stats` and the "What's working" section on the board show pitched, opened, replied and won for each. "Opened but no reply" and "never opened" are different problems: the offer, or the reach.

## Scoring

**Opportunity, 0 to 100.** No site, dead site or directory-only listing scores 90 to 100. Live sites start at 0 and add points for a Google listing that links to a dead page, no HTTPS, no mobile viewport, a free-tier host, poor Lighthouse performance, an old copyright year, a cheap builder, weak SEO basics and missing schema. A live site under 35 is excluded as adequate, unless it shows its age (the signs above, or Lighthouse under 40): those stay in as tier C, because that owner has paid for a site before, and the picker's buyer lane takes them in trades worth replacing it for.

**Viability, 0 to 100.** Review count and rating, hours listed, whether the category usually pays for marketing, a bonus for limited companies, and activity: reviews gained since the listing was first seen, or, under 30 reviews, a recent review date (above that the dates aren't trusted, see the gates). Capped at 60 with no phone number. Chains and closed businesses are excluded.

**Tiers.** A is no or dead site with viability 50 or more. B is a bad live site with opportunity 50 or more. C is everything else above the viability floor of 40. X is excluded, with the reason stated.

Weights, host lists and builder fingerprints live in `config/scoring.yaml`. Category keywords, channels and site must-haves live in `config/categories.yaml`. Change either, then `pnpm pipeline score` and `shortlist` to see the effect without refetching.

## Calibrate before you trust it

After the first run in a new vertical:

1. Open twenty audited sites yourself and compare with `website_status` and `builder`. Aim for nine in ten agreement. Fix host lists and fingerprints until you get there.
2. Read the top fifteen of the shortlist and ask "would I build this one?" Every no is a scoring bug or a missing exclusion.
3. Check tier X for anything that should have been in.

## Decision gates

| After | Signal | Do |
|---|---|---|
| First run | Under 100 viable leads across your target area | Add areas and categories before anything else |
| 30 pitches | Two or more wins | Build the automated build stage (phase 1 in docs/PIPELINE.md) |
| 30 pitches | Replies but no wins | Price or offer problem. Fix before automating |
| 30 pitches | No replies | Channel or pitch problem. Try phone and walk-ins |
| Any time | A complaint or opt-out | Suppress, and check the entity classification was right |

## Develop

```
pnpm test                                   # offline unit tests
pnpm typecheck
pnpm exec tsx scripts/smoke-audit.ts [url]  # fetch, classify, screenshot without API keys
pnpm exec tsx scripts/check-viewport.ts <url>  # what viewport a real phone browser sees
```

## Legal notes

- UK PECR: sole traders and partnerships need consent for marketing email. Limited companies don't, but you must identify yourself and offer an opt-out. Acta only recommends the email channel for high-confidence Companies House matches.
- Previews use licensed stock images and a text logo, never the business's own photos or logo, and sit on a noindex subdomain.
- No scraping. Google Places, PageSpeed Insights and Companies House are all official APIs.
