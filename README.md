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

It starts in Birmingham, UK, and is built to work anywhere with a Google Places listing.

## Where it is now: v1

v1 automates the first three stages and hands you a ranked shortlist with evidence. Building and outreach are still manual, using the scripts in [docs/PLAYBOOK.md](docs/PLAYBOOK.md). The design for the remaining stages, including the automated build agent and email sending, is in [docs/PIPELINE.md](docs/PIPELINE.md).

| Stage | v1 | Later |
|---|---|---|
| Discover, audit, score, shortlist, pitch packs | automated | |
| Pick who to build | you | you, always |
| Research, build, deploy preview, evidence | by hand, with the playbook | phase 1: build agent |
| Draft and send outreach, follow-ups, CRM | by hand | phase 2: sends on your approval |
| Payment, domain, handover, monthly billing | by hand | phase 3 |
| Scheduled weekly runs, reporting | by hand | phase 4 |

One command runs v1 for a plain-English search:

```
pnpm pipeline run "plumbers in Erdington"
```

1. **Discover.** Google Places Text Search, up to three pages, with a per-run request budget and a seven-day cache. Filters to the target postcode area, drops closed businesses, dedups, flags chains.
2. **Audit.** Classifies each website as none, social-only, directory-only, platform-only, down, broken or live. Live sites get HTML checks (mobile viewport, builder, free-tier host, copyright year, schema, phone match), Lighthouse mobile scores via PageSpeed Insights, and phone and desktop screenshots.
3. **Entity.** Matches each business against Companies House. A high-confidence match means it's a limited company, which is the only case where UK law allows cold email. Everyone else gets phone, walk-in or DM.
4. **Score.** Opportunity (how much a site would help) and viability (active, reachable, likely to pay), combined into tiers A to X with plain-English reasons.
5. **Shortlist and packs.** A Markdown table and CSV per run, a pool summary, and a folder per lead with screenshots, Lighthouse JSON and a draft pitch in the right channel.

## Setup

Node 22.13 or newer and pnpm.

```
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

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

Every table links the business to Google Maps, the website to the live site, the phone to a tap-to-call link, and each row to its pitch pack. Each lead gets a one-line hook you can say to the owner and a next step in the right channel.

The leaderboard refreshes on every `run`, `shortlist` and `status` change, so it's always the current to-do list. `pnpm pipeline leaderboard` regenerates it on demand.

Re-running a query updates listing data, skips audits fresher than 14 days, and never resets pipeline status. Anything you've marked contacted, won or lost stays off future shortlists. `lost` and `do_not_contact` also go on a suppression list.

## Scoring

**Opportunity, 0 to 100.** No site, dead site or directory-only listing scores 90 to 100. Live sites start at 0 and add points for no HTTPS, no mobile viewport, a free-tier host, poor Lighthouse performance, an old copyright year, a cheap builder, weak SEO basics and missing schema. A live site under 35 is excluded as adequate.

**Viability, 0 to 100.** Review count and rating, hours listed, whether the category usually pays for marketing, and a bonus for limited companies. Capped at 60 with no phone number. Chains and closed businesses are excluded.

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
```

## Legal notes

- UK PECR: sole traders and partnerships need consent for marketing email. Limited companies don't, but you must identify yourself and offer an opt-out. Acta only recommends the email channel for high-confidence Companies House matches.
- Previews use licensed stock images and a text logo, never the business's own photos or logo, and sit on a noindex subdomain.
- No scraping. Google Places, PageSpeed Insights and Companies House are all official APIs.
