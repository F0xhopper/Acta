# Implementation plan: the remaining pipeline

What is left between today's state and a loop that runs weekly with you at two points: approving previews and answering replies. Seven workstreams, in the order they should be built, each with its data, commands, code, tests and a definition of done.

State today (4 October 2026): discovery is complete and calibrated. The build stage is implemented and proven to the design step on one real business; no site has yet passed all gates end to end. Deploy is coded, untested. Outreach does not exist. Nothing runs on a schedule.

---

## 0. Finish one build

Everything downstream assumes the agent can finish a site. Prove it before writing anything new.

**Steps**

1. Set `BUILD_MAX_TURNS=250` and `BUILD_MAX_MINUTES=180`. Turns are the real cap; minutes are a backstop against a hang. The first run did seven commits in 90 minutes and was in the QA loop when stopped, so 150 was still tight.
2. Resume PHIT: `pnpm pipeline build "PHIT Fitness Academy"` with no `--force`. The skill continues from the components and brief already written. Watch the build log for critic rounds and gate results.
3. Review it by hand with the two questions: is it them, is it good. Note every correction as a line for `CLAUDE.md` or the skill.
4. Build Oslo's Barbers, which has no existing site and no logo, to exercise the wordmark path and the no-site evidence card.
5. Retro on the two build logs: turns per phase, what the critic caught, what the gates caught, what you caught that neither did.

**Code changes expected from the retro**

- The agent reads too much before writing. If phase 1 still takes more than 15 turns, move the photo look into the designer subagent and make phase 1 a single read-and-write turn.
- If the time cap is hit again, add a `--phases` option to the agent step so a build can be run as two invocations (research to structure, then styling to hand over) with the gates between. The skill already resumes from artefacts, so this is orchestration only.

**Done when** two sites have passed all gates, been reviewed, and the review notes have been folded back into the skill.

Estimate: two days, mostly waiting on agent runs.

---

## 1. Deploy

**Status (4 October 2026): built and smoke-tested.** The CLI login on this machine is enough; a token is optional. `previewLabel`, `--from <step>`, `deploy-smoke` and the Vercel line in `doctor` exist. Two things found on the way: a project made from the CLI has no framework preset and serves nothing until it's set, and Standard Protection walls off every `*.vercel.app` address including production, so the pipeline sets both through the API with the CLI's own token. Still to do: the wildcard preview domain, and `vercel git connect` is untested because the smoke site has no GitHub remote.

**Prerequisites, once**

- Vercel Pro. A token named `acta-pipeline`, team-scoped. `VERCEL_TOKEN`, `VERCEL_TEAM_ID` in `.env`.
- Vercel for GitHub installed on the account with access to all repositories, so `vercel git connect` works for every new `site-*` repo without a click.
- `PREVIEW_DOMAIN=preview.acta.agency` with `*.preview.acta.agency` CNAME to `cname.vercel-dns.com`, and the apex domain added to the Vercel team.

**Code**

- `previewLabel(slug)`: a DNS label is at most 63 characters and the long slugs are at the limit. Use `<area>-<business>` without the category, truncated to 40 characters, with a 4-character hash suffix when truncation happened. Store it on the build row as `preview_label`. The Vercel project name uses the same label.
- `pnpm pipeline build <slug> --from deploy`: resume from a named step. Lets a build done before the token existed be deployed without rebuilding. Generalises the resume logic that already exists for failures.
- `pnpm pipeline deploy-smoke`: creates a throwaway `site-smoke` from the starter with the fixture brand, deploys it, verifies the noindex header and the subdomain, tears it down. The test for this whole workstream.
- `pnpm pipeline doctor`: checks every prerequisite the pipeline has and prints what's missing: `gh auth`, `claude` on PATH, Playwright browsers, `.env` keys, Vercel token validity (`vercel whoami`), wildcard DNS resolving, Pinterest session age, sending-domain DNS (workstream 3).

**Tests**

- Unit: `previewLabel` length, uniqueness on collision, lowercase.
- Real: `deploy-smoke` green three times in a row before any real lead is deployed.

**Done when** `deploy-smoke` passes and PHIT is reachable at its preview subdomain with the noindex header.

Estimate: half a day plus whatever Vercel account setup takes.

---

## 2. Research session

**Steps**

1. `pnpm pipeline research --login` once, in a visible browser.
2. `pnpm pipeline research --test "barber"`: new command that runs one query against the live site with the saved session and reports pins found, selectors that matched, and whether a login wall appeared. Fix selectors against what Pinterest actually renders today.
3. Session staleness: when the first query returns zero pins, mark the session stale in `data/builds/_sessions/state.json` and have `doctor` and the build log say so. The build still falls back and continues.

**Done when** a build's board has pins with notes and the designer's brief references at least one of them.

Estimate: half a day.

---

## 3. Outreach

The missing stage. A finished preview with nowhere to send it is worth nothing.

### Compliance rules, built into the code

- Email only when `companies_house.match_confidence = high`. For everyone else the send command refuses and prints the phone, walk-in or DM script instead. There is no flag to override this.
- Every email carries your trading name, postal address and a one-line opt-out. Replies of "no", "stop", "unsubscribe" or "remove" set `do_not_contact` and the suppression list.
- Suppression is checked immediately before every send, not just at draft time.
- Daily cap, ramped: 10 a day in week one, 20 in week two, 30 after. Sends only on weekdays between 09:00 and 11:00 or 14:00 and 16:00 UK time.
- No tracking pixels. Plain text with one link. The comparison image is attached, not hotlinked.

### Data

```
outreach (
  lead_id PK, channel, status,          -- draft | approved | queued | sent | followup_1 | followup_2 | replied | stopped
  to_email, from_email, subject,
  sent_at, followup_1_at, followup_2_at, next_at, last_reply_at,
  provider_message_id, thread_key, stop_reason, updated_at
)
messages (id, lead_id, direction, channel, subject, body, sent_at, provider_id, in_reply_to)
```

Pipeline statuses already include `contacted`, `followup_1`, `followup_2`, `replied`, `won`, `lost`, `do_not_contact`; outreach writes them.

### Where the email address comes from

Gather already extracts an email from the site. Most limited companies without a website have no public email, so expect roughly half of email-eligible leads to have an address. For the rest: phone first, and on a "yes, text it to me", a text with the link. Texting is a later addition via a provider; the pipeline logs the consent and the number for now.

### Sending

- A separate sending domain, never the main one. `mail.acta.agency` or a second registration. SPF, DKIM and DMARC through the provider. Resend is the simplest API; Postmark is the alternative. Config in `config/outreach.yaml`: from name, from address, reply-to, postal address, prices per category, caps, send windows.
- Warm-up is enforced by the ramped cap, not by a separate tool.

### Drafting

`draftEmail(full, build)` builds on the existing `pitch.ts`:

- Subject: "Made you a quick website mock-up, <Business>".
- The hook line the pipeline already writes ("your Google link goes nowhere, and 602 people rate you 4.9").
- The preview link.
- One price from the category config, one monthly line.
- One upsell line from `brand.quality.upsells` (redraw the logo, swap stock for your photos).
- Sign-off, postal address, opt-out.
- Under 120 words. The comparison image attached.

Follow-up one at day three and follow-up two at day eight, from the playbook, two lines each.

### Replies

The pipeline runs on a laptop, so inbound webhooks are awkward. Poll the mailbox over IMAP instead:

- `outreach inbox` connects with `imapflow` to the reply-to mailbox, fetches messages since the last check, and matches each to a lead by `In-Reply-To` against stored message ids, then by sender domain against the lead's email domain.
- A match sets `replied`, stops follow-ups, stores the message, and prints it. Opt-out words set `do_not_contact`.
- Unmatched messages are listed for you to assign with `outreach reply <slug> --from <message id>`.

### Commands

```
pnpm pipeline outreach draft <slug>                 # writes data/outreach/<slug>/email.md, prints it
pnpm pipeline outreach send <slug> --yes            # requires build approved; refuses sole traders; records
pnpm pipeline outreach script <slug>                # phone, walk-in or DM script with the facts filled in
pnpm pipeline outreach run                          # the daily job: due sends within caps, due follow-ups, inbox poll
pnpm pipeline outreach inbox                        # just the poll
pnpm pipeline outreach stop <slug> --reason "..."   # stop a sequence
pnpm pipeline outreach check                        # SPF, DKIM, DMARC present on the sending domain
```

`status <slug> contacted --channel phone` keeps working for calls and walk-ins, and follow-ups for those channels appear as reminders in `outreach run` output rather than automated sends.

### Tests

- Template rendering against fixture leads: word count, every placeholder filled, opt-out and address present.
- Compliance: a sole-trader lead makes `send` throw; a suppressed lead makes `send` throw; a lead not `approved` makes `send` throw.
- Caps and windows: ramp by week, weekend skip, window edges, with a fake clock.
- Follow-up scheduling: day three and day eight land on weekdays.
- Reply matching: fixture IMAP messages with and without `In-Reply-To`, opt-out detection.
- One real send to your own address through the provider before any lead is emailed.

**Done when** one approved preview has been emailed to a real limited company through the sending domain, a reply to your own test message is matched automatically, and `outreach run` has done a day's sends within the cap.

Estimate: three days.

---

## 4. Auto-pick and the weekly loop

**Status (4 October 2026): built.** `sweep`, `searches`, `pick --auto`, `week`, `day`, `schedule`, `doctor` exist and are tested. The `day` job gains outreach sends and the inbox poll when workstream 3 lands. Outcome multipliers switch on by themselves once contacts exist.

### Auto-pick

`pnpm pipeline pick --auto [--max 10]` applies the rule and marks leads `picked`:

- tier A, review count 20 or more, latest review within 12 months
- not a chain, not suppressed, not already built or contacted
- category has a research board or search terms configured
- at most 10 per week, at most 2 per category per area, so your previews don't compete with each other on one high street
- prefers limited companies with an email, since those can be sent automatically

Prints what it picked and why, and what it skipped and why.

### The loop

`pnpm pipeline week`: discover sweep from `config/sweep.txt` (one query or `trade --areas group` per line) → audit → score → leaderboard → `pick --auto` → `build --picked` → review summary written to `out/REVIEW.md` and printed.

`pnpm pipeline day`: `outreach run` → inbox → teardown of `preview_ready` builds untouched for 60 days and anything marked `lost` → leaderboard.

### Scheduling

launchd on the Mac, three plists under `~/Library/LaunchAgents/`:

| Job | When | Runs |
|---|---|---|
| `com.acta.week` | Sunday 22:00 | `pipeline week` |
| `com.acta.builds` | Monday and Tuesday 01:00 | `pipeline build --picked --max 5` |
| `com.acta.day` | Weekdays 09:15 | `pipeline day` |

Each writes to `data/logs/<job>-<date>.log` and sends a macOS notification with the one-line summary. `doctor` reports whether the jobs are loaded.

### Guards

- `BUILD_MAX_PER_DAY=10`, `OUTREACH_MAX_PER_DAY` from the ramp, Places budget per run as today.
- A `--dry-run` on `week` and `day` that prints every action without doing any.
- If `doctor` reports a missing prerequisite, `week` and `day` refuse to start and say what's missing.

### Tests

- Auto-pick rule: table-driven over fixture leads, including the per-area cap and the already-built exclusion.
- `week --dry-run` on the current database prints a plausible plan.

**Done when** a full week has run unattended: sweep Sunday, builds overnight, your review Wednesday, sends on approval, follow-ups on schedule.

Estimate: one and a half days.

---

## 5. Close

Keep this lean until the first yes.

- `pnpm pipeline golive <slug> --domain theirs.co.uk`: already designed. Adds the domain, removes `ACTA_PREVIEW`, redeploys, verifies noindex is gone and the sitemap is served, prints the DNS records they need or sets them if the domain was bought through Vercel. Optional `--transfer-to <github org>`.
- Payment: Stripe payment links, one per package, in `config/outreach.yaml`. The approval email on a yes includes the link. Subscriptions for the monthly fee the same way. No Stripe integration code until volume justifies it.
- Handover: `pnpm pipeline handover <slug>` writes a one-page document from a template: what's included, how to send edits, what the monthly covers, how to cancel, who owns what.
- Uptime: the `day` job fetches every `live` site and alerts on anything not 200.

**Done when** one site is live on a customer's domain with the preview flag off and a paid invoice.

Estimate: one day, after the first yes.

---

## 6. Hardening

Smaller items, do them as they bite.

- **Stale place IDs.** Supreme Plumbers' listing returns 404. When Place Details 404s during gather, re-resolve by name and area, update the place id, and note it. If nothing is found, mark the lead `lost` with the reason.
- **Retro command.** `pnpm pipeline retro` summarises the last N build logs: turns per phase, time, cost, critic rounds, gate failures by name, your rejections. The input to skill edits every ten builds.
- **Starter as a template repo.** Move `starter/` to `acta-site-starter` on GitHub and create sites with `gh repo create --template`. Keep the local copy path as a fallback.
- **Kit as a package.** When a kit fix needs to reach existing sites, publish `src/kit` as `@acta/kit` and have sites depend on a tag.
- **Secrets.** Vercel token scoped to the team, rotated if it ever leaks. The agent's clean environment already keeps it out of site repos.
- **Backups.** `data/leads.db` and `data/brand/` are the business. Nightly copy to iCloud or a Blob bucket from the `day` job.

---

## Sequence and estimates

| # | Workstream | Depends on | Estimate | Done when |
|---|---|---|---|---|
| 0 | Finish one build | nothing | 2 days | two reviewed sites, skill updated from the retro |
| 1 | Deploy | Vercel account setup | done except the preview domain | `deploy-smoke` green |
| 2 | Research session | nothing | half a day | a board with pins the brief uses |
| 3 | Outreach | 1 (the email needs a link) | 3 days | one real send, one matched reply, one capped day |
| 4 | Auto-pick and the loop | 0, 3 | done, except the outreach hook in `day` | a week unattended |
| 5 | Close | first yes | 1 day | one site live and paid |
| 6 | Hardening | as needed | ongoing | |

About eight working days to a weekly loop. Workstreams 1 and 2 can happen while 0's agent runs are in progress, since they're mostly account setup.

The order matters at one point: outreach before auto-pick. Automating the choice of who to build before you can send anything just fills a queue.
