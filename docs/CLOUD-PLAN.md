# Acta in the cloud: hosted, and automated end to end

How to take Acta off this Mac, run it on a server that never sleeps, and let it carry a business from "found" to "pitched" with you touching it only where your judgement earns money. This document plans the hosting, the code changes it needs, the automation it unlocks, the order to do it in, and the decisions still open.

Status (10 October 2026): a plan. Nothing in it is built. The pipeline it describes is the one in the repo today: the v1 CLI, the local UI, the build agent, the outreach stage with warm-up, follow-ups and reply detection, and the lead-gen rework of 10 October.

---

## Contents

1. What "hosted and automated" means here
2. What ties the system to this Mac today
3. Target architecture
4. Hosting options and the recommendation
5. Phase 0: make the code portable
6. Phase 1: one machine in the cloud
7. Phase 2: automated end to end
8. Phase 3: close, operate, scale
9. Phase 4 (optional): Vercel-native
10. Safety, compliance and money
11. Operations
12. Costs
13. Build order and acceptance checks
14. Decisions to confirm

---

## 1. What "hosted and automated" means here

**Hosted.** Every scheduled job, the UI, reply detection and the build agent run on a server. The Mac is a client. If the laptop is shut, leads are still found at 07:30, sites are still built overnight, follow-ups still go out at 09:00 and a reply still moves a business to Replied ten minutes after it lands.

**Automated end to end.** Two lanes, because the law draws the line, not the code:

| Lane | Who | What the machine does | What you do |
|---|---|---|---|
| Cold email | Limited companies with an email (24 of the 96 passers today, rising as SIC matching runs) | Find, audit, score, pick, build, check, deploy, approve, send, follow up twice, detect the reply, draft a suggested answer | Read the reply and answer it. Take the money |
| Call first | Everyone else | Find, audit, score, pick, write the call script, build after you say they said yes, prepare the WhatsApp message with the link, detect the reply | A thirty-second call, one tap to send the WhatsApp, answer the reply |

The principle from `docs/PIPELINE.md` stands: the two things that decide the outcome are choosing the right leads and replying like a human. The picker now chooses well enough to run on its own, so the first is automated with a sampling check. The second stays yours, with the machine drafting.

**Not in scope.** Multi-user, teams, a public product. This is one operator's machine, made reliable and hands-off.

---

## 2. What ties the system to this Mac today

An inventory, from `src/doctor.ts`, `src/loop/schedule.ts`, `src/build/agent.ts`, `src/ui/jobs.ts` and `src/outreach/*`.

| Dependency | Where | Cloud answer |
|---|---|---|
| `data/leads.db`, one SQLite file (`node:sqlite`, WAL) | every stage | Keep SQLite. Stream it to object storage with Litestream. Move to a hosted SQLite (libSQL) only when more than one machine must write (Phase 3) |
| `data/` (cache, screenshots, brand, build logs, jobs, feedback), `out/` (shortlists, packs, deliveries, outbox), `sites/<slug>` (git clones) | every stage | A persistent volume in Phase 1. `sites/` is disposable: the GitHub repos are the source of truth |
| `launchd` jobs: leads 07:30 daily, week Sunday 22:00, builds Monday and Tuesday 01:00, day weekdays 09:15 | `schedule.ts` | A scheduler inside one long-lived daemon process (Phase 0) |
| Reply checking and preview-open refresh run inside the UI server's ticker | `src/outreach/tick.ts` | Same daemon. Today they only run while `pnpm ui` is open |
| Jobs are child processes: `pnpm -s pipeline <args>` per job, one agent job and one search at a time | `jobs.ts` | Unchanged inside a container. Parallel builds become separate machines in Phase 3 |
| Claude Code CLI, headless (`claude -p /build`, the web-email search) billed to the subscription, with a guard that reads `claude -p /usage` | `agent.ts`, `usage.ts`, `web-email.ts` | API key billing (`ACTA_AGENT_API_KEY` already exists) and a cost guard instead of a usage guard. A subscription can't be driven from a server |
| Playwright Chromium: audit screenshots, rendered checks, rescue, the brand crawl, concept mock-ups; Lighthouse and Playwright in each site's gates | audit, gather, build | The official Playwright Linux image. The site CI already runs the same gates on Linux |
| `gh` logged in; `vercel` logged in or `VERCEL_TOKEN` | `repo.ts`, `deploy.ts` | `GH_TOKEN` (a fine-grained token) and `VERCEL_TOKEN`, both already honoured by the CLIs |
| Proton Mail Bridge on this Mac: SMTP for sending, IMAP for replies | `transport.ts`, `replies.ts` | Resend for sending (already supported). A plain IMAP mailbox on the sending domain for replies, polled by the existing ImapFlow code with the host made configurable |
| Pinterest, headless with a session you logged in to by hand | `research.ts` | Off in the cloud. A datacentre IP gets challenged, and the inspiration step already falls back to the galleries |
| The UI on `127.0.0.1:4321`, no login, serving files from local folders | `server.ts` | Bound inside the container, reachable only over Tailscale, or through Cloudflare Access with a login |
| `dig`, `launchctl` in `doctor` | `doctor.ts` | Platform-aware checks |

Nothing here is a rewrite. Every item is a flag, an env var, or a small module.

---

## 3. Target architecture

```
                      ┌──────────────────────────── cloud ─────────────────────────────┐
                      │                                                                 │
  you (phone/laptop)  │   acta daemon (always on, small)          build worker (on demand, big)
  ───Tailscale/Access─┼─▶ UI + API            ┌─────────┐  spawn  ┌──────────────────┐ │
                      │   scheduler ──────────┤ jobs    ├────────▶│ gather, repo,     │ │
                      │   job runner          │ (sqlite)│         │ research, agent,  │ │
                      │   outreach ticker     └─────────┘         │ gate, push, deploy│ │
                      │   alerts                   │              │ evidence          │ │
                      │        │                   │              └────────┬──────────┘ │
                      │   volume: data/ out/ sites/ │                        │            │
                      │        │                   │                        │            │
                      │   Litestream ──▶ object storage (db) ◀── nightly restic (files) │
                      └────────┼───────────────────┼────────────────────────┼────────────┘
                               ▼                   ▼                        ▼
                 Google Places, PSI, Companies House, RDAP, Wayback   GitHub (site-<slug>)   Vercel (previews)
                 Anthropic API (agent, web-email)                      Resend (send)         IMAP mailbox (replies)
                                                                       Upstash (preview opens)
```

Phase 1 runs the daemon and the builds on the same machine, exactly as the Mac does now. Phase 3 moves builds to machines started per job. The daemon is the only writer of the database until then.

---

## 4. Hosting options and the recommendation

| Option | What it is | Code change | Monthly, roughly | Fits |
|---|---|---|---|---|
| A. One Linux VM (Hetzner CPX31: 4 vCPU, 8 GB) | Docker Compose, a systemd timer or the daemon's own scheduler, Tailscale | Phase 0 only | €14 plus storage | Cheapest. One box does everything, builds one at a time, as now |
| B. Fly.io Machines | The same image. One small always-on machine with a volume; build machines started by API and stopped when done | Phase 0, then a worker mode in Phase 3 | $6 always on, $0.10 to $0.15 an hour per 4 GB build machine while it runs, volume $0.15/GB | Pay for builds only while they run. Parallel builds without re-architecture. Secrets, private networking and SSH built in |
| C. Vercel-native (Functions, Workflow, Sandbox, Neon, Blob, Cron) | Rebuild the pipeline as durable workflows; builds in sandboxes | Rewrite of storage, files, jobs and process handling | $20 Pro plus usage | Only if Acta becomes a product with several operators. Section 9 |
| D. A Mac mini on Tailscale (home or colocation) | The Mac, always on | Almost none; keeps Bridge and the subscription | £0 to £40 | Not cloud, but the cheapest way to keep the Claude subscription and Proton Bridge. A fallback, not the plan |

**Recommendation: B, Fly.io, with the Phase 1 shape being a single machine.** The always-on part of Acta is tiny: a web server, a ticker and a scheduler. The expensive part, the build agent, runs for one to four hours a few times a week. On one VM you pay for 8 GB around the clock to serve four hours a night; on Fly the always-on machine is 1 GB and the build machine exists only while it builds. The same Docker image serves both. If you would rather have one plain box you can SSH into and forget, option A is equally valid and every step below applies with Compose instead of `fly`.

Whichever host, three choices go with it:

- **Database stays SQLite** with Litestream streaming the WAL to Cloudflare R2 or Backblaze B2. Restore is one command. The code doesn't change.
- **The sending domain gets a real mailbox.** Resend sends (DKIM and SPF on the domain, already checked by `outreach check`), and a mailbox at Fastmail or Zoho receives replies at the same address over IMAP. Proton Bridge can run headless on Linux, but it is a desktop app held together with a CLI mode; not worth it for one mailbox.
- **Builds bill to the API**, with a per-build cost cap and a monthly budget. The usage guard that polls `claude -p /usage` is for a subscription on a laptop.

---

## 5. Phase 0: make the code portable

Everything in this phase runs on the Mac too, so it can be done and tested before anything is hosted.

| # | Change | Where | Notes |
|---|---|---|---|
| 0.1 | Paths from env: `ACTA_DATA_DIR`, `ACTA_OUT_DIR`, `ACTA_SITES_DIR`, defaulting to today's `data/`, `out/`, `sites/` | `src/config.ts`, `src/build/repo.ts` | So a volume can be mounted anywhere |
| 0.2 | `pnpm pipeline daemon`: one process that runs the UI server, the job runner (`recoverAndRun`), the outreach ticker and a scheduler | new `src/loop/daemon.ts`, `src/ui/server.ts` | The scheduler enqueues `leads`, `week`, `builds`, `day` as jobs at the times in `JOBS`, in the configured timezone, idempotent through a `schedule_runs` table so a restart never double-runs. `schedule install` stays for macOS |
| 0.3 | Cost guard beside the usage guard | `src/build/agent.ts`, `src/build/usage.ts` | With `ACTA_AGENT_API_KEY` set: skip `/usage`; stop a build when `--max-turns`/`--max-minutes` hit (exists) or `BUILD_MAX_COST_USD` is passed (read `total_cost_usd` from stream-json events); refuse to start a build when this month's `agent_cost_usd` total passes `ACTA_MONTHLY_BUDGET_USD`. The web-email search gets the same key and a daily cap on runs |
| 0.4 | IMAP made generic | `src/outreach/config.ts`, `replies.ts` | `imap: { host, port, secure }` with `proton_bridge` kept as a preset. `PROTON_BRIDGE_USER/PASSWORD` become `IMAP_USER/IMAP_PASSWORD` with the old names still read |
| 0.5 | `GH_TOKEN` and git identity from env | `src/build/repo.ts`, Dockerfile | `gh` honours `GH_TOKEN`; set `GIT_AUTHOR_NAME/EMAIL` so site repos still commit as you, not a bot |
| 0.6 | Platform-aware `doctor` | `src/doctor.ts` | Skip `launchctl` when `ACTA_DAEMON=1`; resolve the preview wildcard with `node:dns`; check `IMAP` and `RESEND_API_KEY` when those transports are chosen; check `ANTHROPIC` key presence when API billing is on |
| 0.7 | Research without Pinterest | `src/build/index.ts` | `research.pinterest: false` in `config/build.yaml` skips the session check and the login hint; galleries and competitor screenshots remain |
| 0.8 | Health and alerts | new `src/loop/alerts.ts`, `/healthz` | One function `alert(kind, text)` that posts to a Telegram bot or Slack webhook and, as a fallback, emails you through Resend. Called on: build failed, job stuck (no log line for 30 minutes), sweep found nothing two days running, reply received, cost cap hit, doctor failing at the daemon tick |
| 0.9 | Dockerfile and Compose | `Dockerfile`, `compose.yaml`, `fly.toml` | Base `mcr.microsoft.com/playwright:v1.63.0-noble`; Node 22, pnpm, `@anthropic-ai/claude-code`, `gh`, `vercel`, `git`, `restic`, `litestream`; the starter's `node_modules` baked in so `copyStarter` is fast; `CHROME_PATH` pointed at the image's Chromium for Lighthouse; `pnpm store` on the volume |
| 0.10 | UI binding and a login | `src/ui/server.ts` | Bind to `0.0.0.0` only when `ACTA_DAEMON=1`. Add a single shared-secret cookie login (`ACTA_UI_PASSWORD`) as belt and braces behind Tailscale or Cloudflare Access. The `/files` routes already refuse paths outside their folders; keep that |

Acceptance: `docker compose up` on the Mac runs `doctor` green, a search, an audit, a sandbox build with `--no-agent`, and the UI in a browser, against a copy of `data/`.

About three to four days.

---

## 6. Phase 1: one machine in the cloud

1. **Create the app and the volume.** `fly launch` from the Dockerfile, a 20 GB volume mounted at `/data` holding `data/`, `out/`, `sites/` and the pnpm store. Region: London.
2. **Secrets.** `fly secrets set` for every key in `.env.example` plus `GH_TOKEN`, `VERCEL_TOKEN`, `ANTHROPIC_API_KEY` (as `ACTA_AGENT_API_KEY`), `RESEND_API_KEY`, `IMAP_*`, `UPSTASH_*`, `ACTA_UI_PASSWORD`, the alert webhook, and the Litestream bucket credentials. Nothing in the image.
3. **Move the data.** Stop the Mac's launchd jobs (`schedule uninstall`), copy `data/` and `out/` to the volume once (`fly ssh sftp` or `restic`), verify row counts, then never run the Mac scheduler again. SQLite cannot be merged from two writers; the server is the source of truth from this moment. The Mac keeps `pnpm ui:dev` for development against a restored copy.
4. **Litestream.** A sidecar process in the same container (`litestream replicate` with the config in `litestream.yml`), replicating `/data/data/leads.db` to R2 every second. Test the restore on day one: `litestream restore` to a temp path, open it, count leads.
5. **Nightly files backup.** `restic backup /data/data /data/out` to the same bucket from the daemon's `day` job, with a 30-day retention.
6. **Access.** Tailscale on the machine (`fly` supports it as a sidecar, a VM runs it natively), the UI reachable at `http://acta:4321` from your phone and laptop. Or Cloudflare Tunnel plus Access with your email as the policy. Either; not both.
7. **Email.** Point the sending domain's MX at Fastmail (or Zoho), keep Resend's DKIM and SPF, set `transport: resend`, `replies.check: true`, and send the first test to yourself. `outreach check` must pass before the first real pitch; it already refuses otherwise.
8. **Previews.** `PREVIEW_DOMAIN` and the wildcard CNAME are unchanged. Redeploy existing previews once so the opens beacon and `ACTA_SLUG` are in them.
9. **Schedule.** The daemon's scheduler takes over the four jobs with the same times. `doctor` runs at every tick and the daemon alerts, rather than silently skipping, when a required check fails.
10. **First week.** Run with `automation.auto_pick: false` and `auto_send` not yet built. Confirm each morning: NEW-LEADS written, the leaderboard refreshed, replies detected, one build finished overnight, the backup restored once by hand.

Acceptance: seven consecutive days with the Mac closed, every scheduled job present in the jobs table with exit code 0, one backup restore tested, one reply detected from a test mailbox.

About two to three days of work, then a week of watching.

---

## 7. Phase 2: automated end to end

The stages that are human today, and the machine gate that replaces each one.

| Stage | Today | Automated | The gate that makes it safe |
|---|---|---|---|
| Pick | you, from the Suggested list | `automation.auto_pick: true` (exists): passers only, ten a week, two per trade per area, one walk-in per area, a re-check of the site before committing | New: `auto.reach` for the picker, default `[cold_email]`, so overnight builds are ones the machine can also send. Call-first leads are picked only when you pick them, or when `auto.reach` includes `mobile` |
| Call first | you | stays yours (the law) | The script is ready on the Overview; the inbox item carries the phone number; a "yes" starts the build that night. A WhatsApp-template route through the WhatsApp Business Platform is possible later, with opt-in recorded on the call. Not in this phase |
| Build | overnight job, one at a time | unchanged | Cost cap per build, monthly budget, `BUILD_MAX_PER_DAY` |
| Review and approve | you, two minutes per site | new `automation.auto_approve: true` | A release gate that runs after `evidence`: every build gate passed with no revise round needed, uniqueness passed, cost and turns within one standard deviation of your last twenty builds, and an independent critic pass on the deployed preview (a second `claude -p` run with the critic agent's rubric against the live URL's mobile and desktop screenshots) scoring at least `auto.approve_min_score`. Anything short of that lands in the inbox as before. A sampling rule: one in `auto.review_every` auto-approved sites still goes to you, and your comments still become pipeline rules |
| Send | you press Send | new `automation.auto_send: true` | Only cold-email leads; only inside the warm-up cap and the send window (both exist); `emailBlockers` unchanged (limited company, opt-out line, postal address, DNS passing); a daily send cap separate from warm-up; a kill switch in config read on every tick |
| Follow up | `follow_ups.auto` (exists) | on | unchanged |
| Replies | detected every ten minutes while the UI runs | detected by the daemon | Each real reply triggers an alert with the thread and a drafted answer written by Claude from the delivery, the pitch, the reply and `docs/PLAYBOOK.md`'s "handling replies" table. You send it, edited or not, from the Overview. "No thanks" still auto-suppresses; auto-replies still only recorded |
| Teardown | the `day` job (exists) | unchanged | previews older than 60 days, or lost |

Two things make this safe to leave running:

- **Caps everywhere, in config, read live.** Builds per night, pounds per month, sends per day, auto-approvals per week. Each has a default that is deliberately low (three sends a day, five auto-approvals a week) and a line in `pnpm pipeline outreach status` showing where it stands.
- **A daily digest** at 08:00 (the `day` job): found, passed, picked, built, approved by the machine, sent, opened, replied, won, spent, and anything waiting on you. Every number links to the UI. If the digest doesn't arrive, that is itself the alert.

The learning loop closes here: outcomes by trade, channel and hook (built on 10 October) feed trade values, and trade values feed the picker and the sweep. After thirty pitches the numbers, not the guesses, decide who gets built.

About five to eight days, most of it the release gate and the reply drafter.

---

## 8. Phase 3: close, operate, scale

**Close and operate** (the stages `docs/PIPELINE.md` calls phase 3, needed for "end to end" to mean money):

| Step | Automated | Notes |
|---|---|---|
| Payment | A Stripe Checkout link per site type (build price plus the monthly subscription) created when a reply is classified as positive, pasted into the drafted answer | Stripe webhook to the daemon (`/api/stripe`, exposed through the tunnel or a Fly public route with signature checks) marks the business `won` |
| Domain | On `won`: register or attach the domain through the Vercel Domains API (or recover the expired one the rescue step found), point it at the site's project | The preview subdomain stays as a fallback for a week |
| Go live | Redeploy the project without `ACTA_PREVIEW`, so noindex comes off, the sitemap goes live, the contact form routes to their inbox | Already a flag in the starter |
| Handover | A generated one-page document: how to send edits, what the monthly covers, how to cancel; emailed through Resend | Edits come in as replies; a reply on a won site becomes a `revise` job with the email as the review note, gated by the same release gate |
| Operate | Uptime check per live site in the `day` job; Stripe subscription events; an alert when a card fails | |

**Scale**, when one build a night isn't enough or two markets run at once:

- **Worker machines.** A `pnpm pipeline worker` mode: the machine asks the daemon's internal API for one build job (shared token), runs `build <slug>` and reports steps as they finish. For that to work, the database must accept writes from more than one machine. The least-change path is **libSQL (Turso)**: SQLite semantics, hosted, multi-writer, with a thin adapter under `src/db/index.ts` because every query already goes through `prepare().get/all/run`. Postgres (Neon) is the conventional alternative and a bigger change. Decide when it is needed, not before.
- **Object storage for artefacts.** Screenshots, brand folders, build logs and deliveries move from the volume to R2, served by the UI through signed URLs. Then the daemon is stateless apart from the database and can be redeployed freely.
- **Second market.** `config/areas.yaml` already has Coventry and Wolverhampton switched off; the sweep's budget and the opportunity map need no change. The first thing a second market needs is a second postal address and phone for the pitch footer, which is config.

About five to ten days for close and operate; the worker and storage work is a further week when it is needed.

---

## 9. Phase 4 (optional): Vercel-native

If Acta ever becomes a product with more than one operator, the Fly image becomes the wrong shape and the stack you already use for previews is the right one: the UI and API on Vercel; Neon for the database; Blob for files; Vercel Workflow for each pipeline stage, with `agent` as a step that runs Claude Code in a Vercel Sandbox (a Firecracker microVM that can run for hours); Vercel Cron for the four schedules; Queues for fan-out. The `vercel:workflow`, `vercel:vercel-sandbox` and `vercel:create-a-backend` skills in this repo cover the patterns.

Why not now: it is a rewrite of storage, files and process handling for a system that one person runs a few hours a week, and nothing in Phases 1 to 3 is thrown away if it happens later. The job runner, the lanes, the gates and the config all survive; only their host changes.

---

## 10. Safety, compliance and money

- **Secrets** live in the platform's secret store and reach processes as env. The build agent keeps its clean environment (`cleanEnv`): no pipeline tokens ever reach Claude Code, only the API key for billing.
- **PECR and GDPR** rules are code, not habit: `emailBlockers` refuses anything that isn't a limited company with the opt-out and postal address; the suppression list is honoured before every send; `do_not_contact` is permanent. Add a retention rule: leads untouched for twelve months are deleted by the `week` job, suppression entries never.
- **Previews stay noindex** and under your preview domain; going live is an explicit step on `won`.
- **The agent is boxed**: allowed tools unchanged, max turns and minutes unchanged, plus a cost cap. A build that trips any cap is paused, not retried in a loop.
- **Money has three ceilings**: per build, per month, and the Google Places request budget (already there). Each shows in the digest.
- **Backups are tested**, not assumed: the `week` job restores the latest Litestream snapshot to a temp path, opens it and compares the lead count, and alerts on a mismatch.

---

## 11. Operations

| Concern | How |
|---|---|
| Logs | Job logs stay files on the volume (the UI streams them); the daemon writes JSON lines to stdout, which Fly or `docker logs` keeps for a week |
| Health | `/healthz` returns the last scheduler tick, the last reply check, Litestream's last sync, free disk, and whether a build is running. An external uptime check (Better Stack free tier, or Fly checks) hits it every five minutes |
| Stuck jobs | The job runner already records pid and log; add a watchdog in the ticker: no log line for 30 minutes on an agent job means alert, then kill at the max-minutes limit (exists) |
| Disk | `sites/` is pruned by `teardown` (exists) and by the `day` job for anything torn down or lost; the pnpm store and Playwright cache live on the volume and are bounded |
| Updates | Build the image in GitHub Actions on push to `main`, deploy with `fly deploy` (or `compose pull && up`). Migrations run on start, as now |
| Rollback | The previous image is one `fly releases` away; the database is one `litestream restore` away |
| Dev loop | `pnpm ui:dev` on the Mac against a restored copy of the database; never against the live volume |

---

## 12. Costs

Rough, monthly, with builds as the variable that matters.

| Item | Amount |
|---|---|
| Fly always-on machine, 1 GB, London | about $6 |
| Volume, 20 GB | about $3 |
| Build machines, 4 GB, about three hours each, ten a week | about $15 to $20 |
| Object storage (R2 or B2) for backups and artefacts | about $1 |
| Mailbox on the sending domain (Fastmail or Zoho) | about £4 to £6 |
| Resend, Upstash, Google Places (inside the free tiers at today's volume), PageSpeed, Companies House, RDAP, Wayback | £0 |
| Vercel Pro (previews are commercial use) | $20 |
| Anthropic API for builds, $5 to $15 each, ten a week | $200 to $600 |
| Anthropic API for web-email searches and reply drafts | about $10 |

Everything but the agent is under £60 a month. The agent cost is the business: a site that wins at £395 plus £25 a month pays for twenty attempts. The cost cap and the budget keep it bounded while the win rate is unknown.

The one-VM alternative (option A) replaces the first three lines with about €14.

---

## 13. Build order and acceptance checks

| Order | Work | Done when |
|---|---|---|
| 1 | Phase 0.1 to 0.6: paths, daemon, cost guard, IMAP, tokens, doctor | `pnpm pipeline daemon` on the Mac runs a full day's schedule, with launchd uninstalled, and `pnpm test` is green |
| 2 | Phase 0.7 to 0.10: no Pinterest, alerts, Dockerfile, UI login | `docker compose up` on the Mac passes `doctor` and runs a sandbox build |
| 3 | Phase 1.1 to 1.6: app, secrets, data move, Litestream, restic, Tailscale | The UI opens on your phone; a restore is tested |
| 4 | Phase 1.7 to 1.10: email, previews redeployed, schedule, first week | Seven quiet days, section 6's acceptance |
| 5 | Phase 2: picker reach, release gate, auto-send, reply drafts, digest, caps | The first business goes from found to pitched with no human step, on a cold-email lead, under the caps, and the digest reports it |
| 6 | Phase 3 close and operate: Stripe, domain, go-live, handover | The first win is taken and put live without a terminal |
| 7 | Phase 3 scale, only when needed: worker mode, libSQL, R2 artefacts | Two builds run at once on two machines |

Steps 1 to 4 are about a week of work plus a week of watching. Step 5 is a further one to two weeks. Step 6 waits for the first "yes", which is the right order: don't build the till before the first sale.

---

## 14. Decisions to confirm

1. **Host**: Fly.io machines (recommended) or one Hetzner VM.
2. **Billing for the agent**: API key (recommended, required for a server) or keep the subscription on a Mac mini at home (option D).
3. **Replies**: a Fastmail or Zoho mailbox on the sending domain (recommended) or Proton Bridge headless on Linux.
4. **Access**: Tailscale (recommended, nothing public) or Cloudflare Access (works from any browser with an email login).
5. **Auto-approve**: on from the start with sampling (one in five to you), or off until twenty hand reviews have gone through without a comment.
6. **Auto-send caps**: three a day inside the warm-up, five auto-approvals a week, £300 a month on the agent. Raise them with evidence.
7. **The picker's reach**: cold-email leads only for the overnight builds (recommended), or mobiles too, which makes call-first the bottleneck.
8. **Pinterest**: drop it in the cloud (recommended) or keep a session file that you refresh monthly from the Mac.
9. **Retention**: delete untouched leads after twelve months.
10. **A second market**: not until the first has thirty pitches and the trade values have moved.
