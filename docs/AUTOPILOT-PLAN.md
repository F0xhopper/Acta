# Autopilot: run the pipeline on the laptop until usage hits 70%

Written 2026-10-10 after reading the code; implemented the same day (src/loop/autopilot.ts, src/loop/notify.ts, src/loop/schedule.ts). Kept as the design record.

The switch (`setAutopilot` in src/loop/autopilot.ts) is one flag in config/build.yaml acted on at once: the header pill on every UI page, the Inbox panel and `pnpm pipeline autopilot on|off` all go through the running server (the CLI pokes it over HTTP, src/ui/poke.ts, and falls back to the flag alone when no server answers). Off stops it starting anything new; a running build is left alone, and paused builds still resume.

## What exists already

- Usage guard: `ACTA_USAGE_STOP_PERCENT=70` (src/build/usage.ts). The agent polls `claude -p /usage` every 3 min and SIGINTs the build at the threshold; the build goes to `awaiting_usage` and resumes its saved conversation later (src/build/index.ts, agent-session.json).
- Daily lead run: `pnpm pipeline leads` (src/loop/leads.ts). `automation.sweep: true`. The launchd job `com.acta.leads` is NOT installed (launchctl shows nothing).
- Auto-picker: `autoPick()` in src/pick/index.ts picks only leads that pass every gate in config/pick.yaml (trade, gap, established, reach, content), audit under 30 days, diversity caps, and re-checks the site and the Google listing first. Only wired to the Sunday `week` job and gated by `automation.auto_pick` (false).
- Build queue: `pnpm pipeline build --picked --max 5`, launchd `com.acta.builds` Mon/Tue 01:00 (not installed). Stops the queue at the usage limit.
- UI server (`pnpm ui`, src/ui/server.ts): job queue with lanes (one agent job at a time, src/ui/jobs.ts), `startUsageResumer` (every 5 min re-queues `awaiting_usage` builds once usage is under the limit), outreach ticker, auto screenshots after a build.
- Notifications: none. `osascript` is available; `terminal-notifier` is not.

## Design: one always-on daemon, the UI server

The autopilot is a ticker inside the UI server (like `outreachTick`), because the server already serialises agent jobs, resumes usage pauses and shows everything in Activity. The server is installed as a launchd agent with `KeepAlive` so it runs whenever the Mac is on.

### Config, config/build.yaml

```yaml
automation:
  autopilot: true     # pick the best passer, build it, notify you, repeat, until usage reaches the limit
autopilot:
  max_builds_per_day: 3
  max_unreviewed: 3   # stop starting builds while this many previews wait for your review
  leads_at: "07:30"   # the daily lead run (replaces the com.acta.leads calendar job)
  day_at: "09:15"     # weekday housekeeping (pnpm pipeline day)
  week_at: "22:00"    # Sunday re-audit and score (pnpm pipeline week)
```

`auto_pick` stays false: the autopilot picks one lead at a time, just before it builds it (`autoPick({ max: 1 })`), so the re-check is fresh and picks never pile up.

### Tick (every 60 s, `busy` flag), src/loop/autopilot.ts

1. Resume: any `awaiting_usage` build with no active job and usage under the limit -> enqueue `build <slug>` (moves `startUsageResumer` here).
2. If `automation.autopilot` is off -> stop.
3. Chores: for leads (daily), day (Mon-Fri), week (Sun): if local time is past the chore's time and no job of that kind was created today (jobs table) -> enqueue. Needs JobKind `day` and `week` in src/ui/api-types.ts and src/ui/jobs.ts (`jobArgs`, `LANE`: week=search, day=quick).
4. If an agent-lane job is queued or running -> stop (one build at a time).
5. Usage over the limit (`overLimit(await getUsage({ wait: true }))`) -> idle, reason "usage at X%, waiting for the reset".
6. `preview_ready` builds count >= max_unreviewed -> idle, reason "N previews waiting for your review".
7. Distinct build targets with a job created today >= max_builds_per_day -> idle.
8. Queue: first of `pickedQueue()` -> enqueue `build <slug>`.
9. Else `autoPick({ max: 1 })` -> if it picked, enqueue `build <slug>`; else idle, reason "no lead passes every gate; next lead run at 07:30".
10. Failed builds are not retried automatically: the notification covers them.

Keep the current reason in memory; notify once when it changes to the review cap or the usage pause.

### Notify, src/loop/notify.ts

`notify(title, text, { url })`:
- macOS: `osascript -e 'display notification "<text>" with title "Acta" sound name "Glass"'` (escape quotes and backslashes).
- Optional push to the phone: `ACTA_NOTIFY_URL` in .env, an ntfy.sh topic URL or any URL that takes a POST; headers `Title` and `Click`. Add to .env.example.

Hook `onJobDone` in server.ts for build/revise/concepts jobs: state `preview_ready` -> "Site ready to review: <name>" with the preview URL; `failed` -> "Build failed: <name> at <step>: <error>".

### Keep the Mac awake during a build

In src/ui/jobs.ts `start()`, for agent-lane jobs on darwin spawn `caffeinate -i -w <child.pid>` (detached, unref) so idle sleep doesn't freeze a build mid-way.

### Schedule, src/loop/schedule.ts

Add job `com.acta.ui`: `pnpm -s pipeline ui`, `RunAtLoad` + `KeepAlive` (plist needs `<key>KeepAlive</key><true/>` instead of `StartCalendarInterval`). Default install set: autopilot on -> `['ui']`; off -> the four calendar jobs. `pnpm pipeline schedule install` then installs one thing. Doctor: when autopilot is on, check `com.acta.ui` is loaded and `ui/dist/index.html` exists (`pnpm ui:build`). Note in README: with the daemon installed, `pnpm ui:dev` must use another port or `launchctl unload` first.

### API and UI

- `GET /api/autopilot` -> `{ on, reason, buildsToday, unreviewed, nextChore }`; `POST /api/autopilot` body `{ on }` edits the config line like `setSweep` does.
- CLI: `pnpm pipeline autopilot status|on|off`.
- UI: a toggle and status line on the Inbox (mirror the Auto-find button in ui/src/routes/leads.tsx), using `useQuery('/api/autopilot')` in ui/src/api.ts.

### Tests

- Pure tick decision function (`decide(state) -> action | idle reason`) in test/autopilot.test.ts: usage over, review cap, daily cap, queue first, pick second, chore due once per day.
- `notify` text escaping.
- Existing: build-state, pick-rules, ui-server still pass.

### Things for the user to decide

- Gate `reach` in config/pick.yaml is `[cold_email, email, mobile, social]`; set `reach: [cold_email]` if the autopilot should only build leads that can be cold emailed with no call.
- `max_unreviewed` and `max_builds_per_day` values.
- Whether to add `ACTA_NOTIFY_URL` for phone pushes (ntfy app) on top of macOS notifications.
