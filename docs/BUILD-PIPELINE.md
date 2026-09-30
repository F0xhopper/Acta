# The build pipeline: engineering design

How `acta build <slug>` takes a picked lead to a live, tested, reviewed preview on Vercel with no hands on it. This is the mechanics under [BUILD-PLAN.md](BUILD-PLAN.md) section 8.

---

## 1. Principles

- **Every step is idempotent and recorded.** A build is a row in a `builds` table that moves through states. Re-running `acta build <slug>` resumes from the last good step. Nothing is created twice.
- **The agent never deploys, pushes or holds a token.** It designs and codes inside a repo whose environment has no credentials. The pipeline process owns GitHub and Vercel access and does every outward step itself.
- **Gates are run by the pipeline, not trusted from the agent.** The agent runs them to iterate. The pipeline runs them again on the final commit before anything deploys, and CI runs them on every push forever after.
- **Caps everywhere.** Turns, wall clock, concurrent builds, API budgets. A runaway build costs a bounded amount and leaves a readable log.
- **Teardown is a first-class command.** A "no" or sixty days of silence deletes the deployment and archives the repo the same way it was created.

---

## 2. State machine

```
picked ─► gathered ─► repo_ready ─► built ─► gated ─► deployed ─► evidenced ─► preview_ready
   │          │            │          │        │          │            │
   └──────────┴────────────┴──────────┴────────┴──────────┴────────────┴──► failed (step, reason, attempts)

preview_ready ─► approved ─► (phase two: contacted ... won ─► live)
preview_ready ─► rejected(note) ─► revising ─► gated ─► deployed ─► evidenced ─► preview_ready
any ─► torn_down
```

`builds` table:

```
lead_id, state, step_started_at, step_attempts, last_error,
repo_url, repo_default_branch, head_sha,
vercel_project_id, vercel_project_name, deployment_url, preview_url,
brand_json_path, gate_json_path, evidence_path, agent_result_path,
agent_turns, agent_seconds, build_started_at, built_at, reviewed_at, review_note,
torn_down_at
```

Each step: check state → do work → verify the effect exists (repo has commits, deployment is READY) → advance state. Verification, not return codes, decides success. Per-step retry with backoff, three attempts, then `failed` with the step name so the review queue shows "failed at deploy: domain not verified" rather than "failed".

---

## 3. Prerequisites, done once

| Need | How |
|---|---|
| GitHub CLI authenticated as the account that owns the repos | already done (`gh auth status`) |
| Vercel Pro team, CLI authenticated, `VERCEL_TOKEN` and `VERCEL_TEAM_ID` in `.env` | `vercel login`, then a token from the dashboard for headless use |
| Vercel for GitHub app installed on the account with access to **all repositories** | so every new `site-*` repo can be connected without a click |
| `preview.acta.agency` on the Vercel team with wildcard DNS (`*.preview` CNAME to Vercel) | once; every site claims a subdomain under it |
| `acta-site-starter` template repo published | milestone 2 in the plan |
| `@acta/kit` published (npm, or a git tag the starter pins) | milestone 2 |
| Pinterest session saved for headless research | `acta research --login` opens a visible browser once, stores `data/sessions/pinterest.json` |
| Claude Code on this machine with the Chrome extension optional | interactive builds only |

`.env` gains `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `GITHUB_OWNER=F0xhopper`, `PREVIEW_DOMAIN=preview.acta.agency`, `BUILD_CONCURRENCY=2`, `BUILD_MAX_TURNS=200`, `BUILD_MAX_MINUTES=90`.

---

## 4. The steps

Working directory for a build is `sites/<slug>/`, gitignored in this repo. Logs go to `data/builds/<slug>/build.log`, one line per event, JSON.

### Step 0: gather

Deterministic code in the pipeline. Output cached under `data/brand/<slug>/` so a rebuild doesn't refetch.

1. Place Details for photos and attributes: `GET /v1/places/{id}` with field mask `photos,accessibilityOptions,paymentOptions,parkingOptions,goodForChildren,allowsDogs`. Each photo via `GET /v1/{photo.name}/media?maxWidthPx=1600` to `brand/photos/google-N.jpg` with its attribution recorded.
2. Site crawl when the audit says live: Playwright with the iPhone profile, homepage plus up to eight same-domain links whose text or path matches about, services, contact, gallery, team. Save HTML, computed styles of header, nav, buttons, links and headings, every image over 600 px, every `<link rel>` icon.
3. Logo ranking, colour vote, font detection, facts extraction as in the plan. Write `brand.json`, `facts.json`, `brand/logo.(svg|png)`, `brand/photos/site-N.jpg`.
4. Quality flags into the same file: `logo_quality` (svg, raster_ok, raster_low, none), `photo_count`, `colour_confidence`. These drive upsell lines in the pitch and tell the designer what it's working with.

Verification: `brand.json` parses against its zod schema. State `gathered`.

### Step 1: repo

```
gh repo create $OWNER/site-$SLUG --template $OWNER/acta-site-starter --private \
  --description "Acta preview for <Business name>" --clone -- sites/$SLUG
```

GitHub copies template contents asynchronously, so the clone can come back empty. Poll `gh api repos/$OWNER/site-$SLUG/commits` until it returns at least one commit, up to sixty seconds, then `git pull`. Then:

1. Write `acta/lead.json`, `acta/brand.json`, `acta/facts.json`; copy `brand/` to `public/brand/`.
2. `pnpm install --frozen-lockfile`.
3. `git add -A && git commit -m "chore: seed from Acta (<lead slug>, <date>)"` and `git push`.
4. `gh repo edit --add-topic acta-preview --enable-issues=false`.

Verification: `git ls-remote` shows `main` at the seed commit. State `repo_ready`. Re-run: if the repo exists and has the seed commit, skip.

### Step 2: build

```
cd sites/$SLUG
env -i PATH="$PATH" HOME="$HOME" ACTA_BUILD=1 \
  claude -p "/build" --output-format json --max-turns $BUILD_MAX_TURNS \
    --allowedTools "Read,Edit,Write,Glob,Grep,Bash(pnpm *),Bash(node scripts/*),Bash(git add *),Bash(git commit *),WebFetch,mcp__playwright__*" \
    > ../../data/builds/$SLUG/agent-result.json
```

- `env -i` gives the agent a clean environment. No `VERCEL_TOKEN`, no GitHub token, no Google keys. It can't deploy or spend even if it tries.
- The pipeline wraps the process in a wall-clock timeout of `BUILD_MAX_MINUTES` and kills the process group on expiry.
- The agent commits as it goes. It cannot push: `git push` isn't in the allowlist and there's no credential in the environment anyway.
- Result JSON is parsed for `is_error`, turn count, duration and the final message. Stored on the build row.

Verification: the repo has at least one commit after the seed, and `acta/build-log.md` exists. State `built`. On a crash or timeout: `failed at build` with the tail of the log.

### Step 3: gates, run by the pipeline

```
cd sites/$SLUG && pnpm gate --out acta/qa/gate.json
```

The pipeline runs this itself on the agent's final commit. It does not read the file the agent left. `gate.ts`:

1. `pnpm build`, then `next start` on a free port.
2. Lighthouse via the `lighthouse` npm package and `chrome-launcher`, mobile preset, against `http://localhost:PORT/` and one service page. Local, so no PageSpeed budget is spent.
3. Crawl the local server for every internal link, check every external one with a HEAD.
4. Images: `sharp` metadata for size and dimensions; cheerio for alt text; count of `public/brand/photos/*` references.
5. Facts and claims: cheerio text of every page against `site.ts` and `facts.json`.
6. Contrast: every pair in `theme.ts` through a WCAG contrast function.
7. Uniqueness: Playwright mobile screenshot of the hero and the full home page, perceptual hash (`blockhash`), Hamming distance against every hash in `data/builds/*/hashes.json`. Fail under the threshold.
8. Originality: twelve-word shingles of every page against the pages saved in `acta/research/`.
9. Writes `gate.json` with a `pass` boolean, one entry per gate with measured values, and the `head_sha` it ran against.

Verification: `gate.json` validates against the shared zod schema in `@acta/kit`, `pass` is true, `head_sha` matches `git rev-parse HEAD`. State `gated`.

On failure: if `step_attempts < 2`, push the commit, run the agent again with `/revise` and the failing gate names as the argument, then gate again. Otherwise `failed at gates` with the failing entries listed. The review queue shows them.

### Step 4: push and CI

`git push origin main` from the pipeline. The starter ships `.github/workflows/ci.yml`:

```yaml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm gate --ci   # same gates, uniqueness skipped (no other sites in CI)
      - uses: actions/upload-artifact@v4
        with: { name: gate, path: acta/qa/ }
```

Branch protection on `main` requires `ci` to pass for pull requests. During the preview phase the pipeline pushes straight to `main` and CI is the record. After go-live, edits arrive as pull requests and the same gates protect the customer's site.

The pipeline waits for the CI run with `gh run watch` and treats a red run as `failed at ci`. This catches "works on my machine" gaps between the Mac and a clean Linux box, which is exactly what Vercel's build will be.

### Step 5: Vercel

All through the CLI with `VERCEL_TOKEN` and `--scope $VERCEL_TEAM_ID`, from inside the repo.

```
vercel project add site-$SLUG                          # idempotent: exists is fine
vercel link --yes --project site-$SLUG
vercel git connect                                     # ties the project to the GitHub repo via the installed app
printf '1' | vercel env add ACTA_PREVIEW production
vercel deploy --prod --yes                             # returns the deployment URL
vercel inspect <deployment-url> --wait --timeout 10m   # blocks until READY or errors
vercel domains add $SLUG.$PREVIEW_DOMAIN               # attaches the subdomain to this project
```

Why production deployments: on a Pro team, preview deployments have Vercel Authentication on by default, which would put a login wall in front of the business owner. Production deployments of a project are public. The site is still a preview to us, and the `ACTA_PREVIEW` env makes `next.config.ts` add `X-Robots-Tag: noindex, nofollow` to every response and serve a disallow-all `robots.txt`.

Why `git connect` as well as a CLI deploy: the CLI deploy is deterministic for the pipeline. The git connection means later pushes deploy on their own, which is what you want once the customer is live and edits arrive as pull requests. Vercel then also builds preview deployments for those PRs.

Verification: `GET https://$SLUG.$PREVIEW_DOMAIN/` returns 200 with the noindex header and the business name in the title. State `deployed`.

Failure modes: domain not yet verified (wildcard DNS missing, fail fast with a clear message); build failed on Vercel (fetch the build logs with `vercel logs`, store the tail, `failed at deploy`); git connect refused (app not installed for this repo, message says so).

### Step 6: evidence

1. Playwright mobile screenshot of the preview URL, saved to the repo under `acta/qa/preview-mobile.png` and to the pitch pack.
2. Lighthouse against the preview URL, mobile, for the number on the picture. Local Lighthouse again, no budget.
3. `evidence.ts` composes `compare.png`: their current site's mobile screenshot (from the audit, or a "no website" card) beside the preview, both in phone frames, scores underneath, their logo above.
4. Hashes of the hero and page saved to `data/builds/<slug>/hashes.json` for future uniqueness checks.

State `evidenced`, then `preview_ready`. The pitch pack, shortlist and leaderboard regenerate with the link, the picture and the upsell lines from gather.

### Step 7: notify

A line in the terminal, a macOS notification if the run was started interactively, and the review queue. Nothing is sent to the business.

---

## 5. Review, revise, approve, teardown, go-live

```
acta review                      # every preview_ready and failed build: link, compare.png, logo and palette found, gate summary
acta approve <slug>              # state approved; phase two takes it
acta reject <slug> --note "hero photo is a supplier's van, use the shop front"
acta teardown <slug> [--keep-repo]
acta golive <slug> --domain theirs.co.uk
acta builds [--failed]           # table of every build with state, durations, turns, cost
```

**Reject** pushes the note into `acta/review-notes.md`, runs the agent with `/revise`, then steps 3 to 6 again. Attempts are counted so a site can't loop forever.

**Teardown**: `vercel domains rm`, `vercel project rm --yes`, `gh repo archive` (or `gh repo delete --yes` with `--purge`), local clone removed, brand cache kept, state `torn_down`. Run automatically for `preview_ready` builds untouched for sixty days and for anything marked `lost` or `do_not_contact`.

**Go-live**: `vercel domains add theirs.co.uk`, print the DNS records they need or set them if the domain was bought through Vercel, `vercel env rm ACTA_PREVIEW production`, `vercel deploy --prod`, verify the header is gone and the sitemap is served. Optionally `gh repo transfer` to a GitHub org owned by the customer. State `live`.

---

## 6. Testing

Three layers, each cheap to run, each catching a different kind of failure.

### The pipeline (this repo)

- **Unit, vitest, offline.** Logo candidate ranking against fixture HTML for Wix, WordPress, Squarespace and a hand-rolled site, including a page whose only images are supplier badges. Colour vote with fixture styles. Facts extraction with an about page that mentions Gas Safe and a founding year. State transitions: every legal edge, every illegal one rejected. Command builders for `gh` and `vercel` produce the expected argv. The gate.json schema.
- **Sandbox build.** `acta build <slug> --sandbox` runs gather, creates the repo as a local folder from a local checkout of the starter, runs the agent, runs the gates, and stops. No GitHub, no Vercel. This is how the skill is iterated on without spending anything outward.
- **Dry run.** `acta build <slug> --dry-run` prints every command it would run with real values and exits.
- **Smoke, real, on demand.** `acta build smoke --real` builds a fixed fake lead ("Acta Test Barbers", fixture brand) into `site-smoke`, deploys it, checks the URL, tears it down. Run before any change to the orchestrator is merged, and nightly if you like.

### Each site (the starter)

- **Unit, vitest.** `site.ts` matches the facts schema. Every route renders in a React test renderer without throwing. `theme.ts` passes the contrast function.
- **End to end, Playwright.** Home loads under the mobile profile, the `tel:` link is present and correct, the WhatsApp link opens the right number, the contact form submits to the kit's handler with a mocked transport, every service and area page returns 200, `axe` reports no serious violations.
- **The gates** are themselves a test suite with fixtures: a page with a fake phone number fails facts, a page with "award-winning" and no evidence fails claims, a hero over 150 KB fails images.
- **CI** runs all of it on every push.

### The agent's process

- **Build logs are the dataset.** Every ten builds, the retro reads them. Corrections you made twice become rules.
- **Skill evals** with the skill-creator skill once there are twenty logs: does the current skill, given a saved `brand.json` and `facts.json`, produce a brief that names its differences from the last five and a theme that passes contrast on the first try.

---

## 7. Security and permissions

| Concern | Rule |
|---|---|
| Tokens | Only in this repo's `.env`, only in the pipeline process. The agent runs under `env -i` with no tokens. Site repos contain no secrets; Vercel env is set through the CLI |
| GitHub token scope | The `gh` login already has repo scope. Nothing else is needed |
| Vercel token | Team-scoped, named "acta-pipeline", rotated if it ever leaks |
| Agent permissions | `.claude/settings.json` in the starter allows `pnpm`, `node scripts/*`, `git add`, `git commit`, the Playwright MCP; denies `git push`, `rm -rf`, `curl`, `wget`. Headless runs pass the same list as `--allowedTools` |
| Network for the agent | WebFetch allowed for the research allowlist (Pinterest, the galleries, the competitor URLs in `lead.json`) and nothing else |
| Customer data | `lead.json` holds public listing data. Nothing about the owner as a person beyond what their own site says |
| Deletion | Teardown is the only destructive command, needs `--yes` when run by hand, and archives before it deletes |

---

## 8. Concurrency, caps and cost

- `BUILD_CONCURRENCY=2`. Two agents, two Chrome instances, two Lighthouse runs at once is what a laptop handles. `--picked` processes the queue in score order.
- Per build: `BUILD_MAX_TURNS`, `BUILD_MAX_MINUTES`, two gate attempts, three attempts per outward step.
- Per day: `BUILD_MAX_PER_DAY=10` so a bad auto-pick rule can't burn a week's allowance overnight.
- Places: one Details call per build, inside the existing budget counter.
- Lighthouse and screenshots are local, so no external budget.
- Every build row records agent turns and seconds, so `acta builds` can show what a site costs in practice and the retro can watch the trend.

---

## 9. Observability

- `data/builds/<slug>/build.log`: one JSON line per event, with step, attempt, duration, and any command output tail.
- `acta builds`: table of every build, state, durations per step, turns, gate results, links.
- `acta builds --failed`: grouped by failing step and reason, so a systematic problem (every Wix site fails the logo check, say) is visible as a number, not a feeling.
- The leaderboard's in-progress section shows building, preview_ready and rejected with their links.

---

## 10. Failure modes and what happens

| Failure | Handling |
|---|---|
| Template clone comes back empty | poll for commits up to 60 s, then pull |
| Agent exceeds turns or wall clock | process group killed, `failed at build`, log tail in the review queue |
| Agent leaves uncommitted work | pipeline commits it as "wip: agent left changes" so nothing is lost, then gates decide |
| Gates fail twice | `failed at gates` with the entries, human decides: reject with a note, or tear down |
| CI red on Linux but green locally | `failed at ci` with the job URL. Usually a case-sensitive path or a missing dependency |
| Vercel build error | `vercel logs` tail stored, `failed at deploy` |
| Domain not verified | fail fast before deploying, message names the DNS record needed |
| Uniqueness gate fails | the critic gets the nearest existing site's screenshot in the revise prompt: "too similar to this, change the layout concept" |
| Pinterest session expired | research falls back to the category's last board and flags it; `acta research --login` fixes it |
| Places photo fetch denied | site photos and stock only, `photo_count` reflects it |

---

## 11. Build order for the pipeline itself

1. `builds` table, state machine, `acta builds`, the logger. Unit tests for transitions.
2. Gather, tested on twenty leads from the database, checked by eye.
3. Starter repo with CI and gates, deployed empty by hand to prove the Vercel path. Gate fixtures.
4. Repo step and Vercel step, each with `--dry-run`, then the real smoke build of `site-smoke`, then teardown.
5. Build step with the sandbox mode, iterated with the interactively written skill.
6. Evidence, review, approve, reject, revise.
7. `--picked`, concurrency, daily cap, auto-teardown.

Nothing in 4 onward runs against a real lead until the smoke build has gone up and come down cleanly three times.
