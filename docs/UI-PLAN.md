# Acta UI: version one plan

A local web app for running the Acta loop without the terminal: pick a business, watch the build, review the site, approve it, send the pitch, record what happened. This document plans version one: its principles, pages, features, data changes, build order and tests.

Status (7 October 2026): version one is built, including the two checkpoints. Run it with `pnpm ui:build` then `pnpm ui`. Changes made while building: the automatic sweep and the auto-picker are switched off for now (`automation` in `config/build.yaml`), so searching and picking are manual; the Inbox gained a discovery strip; the look moved to the dark glass style in section 6; and the three decisions in section 13 were taken as recommended.

---

## Contents

1. Scope
2. Principles
3. Information architecture
4. Pages and features
5. Shared components
6. Visual design
7. Architecture
8. API and data changes
9. Pipeline changes: the two checkpoints
10. Build order
11. Testing
12. Not in version one
13. Decisions to confirm

---

## 1. Scope

**The job of version one:** take one business from "picked" to "sent" and record the reply, entirely in the browser, with you touching it only where your judgement matters.

**In version one**

| # | Feature | Where it lives |
|---|---------|----------------|
| 1 | Needs you inbox | Inbox page |
| 2 | Review studio | Business page, Review tab |
| 3 | Before-and-after compare | Business page, Compare tab |
| 4 | Live build progress | Business page, Progress tab |
| 5 | Pipeline board | Pipeline page |
| 6 | Delivery composer | Business page, Deliver tab |
| 7 | Usage meter and pre-flight warning | Header, and every action that starts an agent |
| 8 | Concept picker | Business page, Concepts tab (milestone 4) |
| 10 | Photo curator | Business page, Photos tab (milestone 4) |

Features 8 and 10 come last because they need pipeline changes, not just UI. They are in version one because they are the biggest quality gains for the sites. They are the first thing to cut if version one runs long.

A small Leads table and an Activity page are also included. They are not features in their own right, but the loop cannot start without picking a lead, and jobs need somewhere to be watched and cancelled.

**Everything else is version two or later.** See section 12.

---

## 2. Principles

1. **One operator, one machine.** The app runs on your Mac at `127.0.0.1`. No accounts, no cloud, no login.
2. **A thin shell over the CLI.** Every button runs an existing `pnpm pipeline` command as a background job. The UI never writes site files itself. The CLI, the scheduler and the UI therefore always agree, and anything you can click you can also script.
3. **Inbox first.** The app opens on what needs you. Each waiting item appears once, with one obvious primary action.
4. **One page per business.** Everything about a business lives at one address. Tabs appear as the business moves forward, so you never see an empty Deliver tab on a lead that hasn't been built.
5. **The server is the source of truth.** The browser caches and refreshes. Only status changes are optimistic, and they roll back if the server refuses.
6. **Confirm what costs, undo what doesn't.** Starting an agent run, cancelling a build, tearing down a site and marking "do not contact" ask first. Everything else happens at once with a short undo toast.
7. **Fix the pipeline, not the site.** Any review comment can be flagged "make this a pipeline rule". Flagged comments collect in a rules inbox so they get folded into the starter, skills or gates, never hand-fixed on one site.
8. **Accessible by default.** Everything works by keyboard. Drag and drop always has a menu alternative. Colour is never the only signal. Text meets WCAG AA contrast. Motion respects "reduce motion".
9. **Every view has four states.** Loading, empty, error and full, each designed, none left as a blank panel.
10. **Fast and quiet.** No spinners over 300 milliseconds without a skeleton. No modal where a toast will do. No marketing chrome.

---

## 3. Information architecture

Simplified on 7 October 2026 after the first build of the UI: fewer places to look, one word per stage, and one obvious action per screen.

### Navigation

Three items. Activity and usage live in the header, because you glance at them rather than go to them.

| Item | Address | Purpose |
|------|---------|---------|
| Inbox | `/` | What needs you, a slim strip of the pipeline, and what's in progress |
| Pipeline | `/pipeline` | Every active business as a card on a board |
| Leads | `/leads` | Find new businesses, then pick the ones worth building |

In the header: a "running" pill that opens Activity (every job with its log), and a usage pill showing the higher of session and week, with both bars a click away.

### One word per stage

Every chip, column and inbox row uses the same words: New, Picked, Building, Needs photos, Needs a concept, Build failed, Making changes, To review, Ready to send, Sent, Followed up, Replied, Won, Lost. Build internals such as "gates passed" or "repo ready" never appear.

### Business page

Address: `/b/:slug/<tab>`. Four tabs, in the order a business moves through them. A tab appears once it has something in it, and the tab waiting on you has a dot.

| Tab | Content |
|-----|---------|
| Overview | The next step as one button, or the outcome buttons after the pitch (They replied, I followed up, Won, Lost). Why it scored, facts, reviews, timeline |
| Build | Progress, plus Photos and Concepts views. When the build waits for you, that view opens first |
| Review | Comment on screenshots (click anywhere), the live site, and Compare between rounds. Two actions: Request changes and Approve |
| Send | The email, WhatsApp message, script and package |

The page opens on the tab that needs you. Older addresses (`progress`, `photos`, `concepts`, `compare`, `deliver`) redirect to their new place.

### The loop, with your touch points

```
 pick ─▶ gather ─▶ [Photos] ─▶ research ─▶ concepts ─▶ [Concepts] ─▶ build ─▶ gates ─▶ deploy
                      you                                   you
                                                                                       │
 won/lost ◀─ [reply] ◀─ sent ◀─ [Deliver] ◀─ approve ◀─ [Review] ◀────────────────────┘
               you                 you                    you  ─▶ revise ─▶ Review again
```

Bracketed steps wait for you and appear in the inbox. Everything else runs on its own.

---

## 4. Pages and features

### 4.1 Inbox (feature 1)

**Purpose.** Answer "what should I do next?" in under five seconds.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Needs you (4)                                                        │
│ ● Review    Oslo's Barbers        Round 2 ready · 12 min ago [Review]│
│ ● Failed    PHIT Fitness          Gates: contrast · 1 h ago  [Retry] │
│ ● Send      Hair by Jo            Approved · email allowed   [Send]  │
│ ● Photos    Kings Heath Bakery    31 photos to sort          [Sort]  │
├──────────────────────────────────────────────────────────────────────┤
│ Running                                                              │
│ Build · Kings Heath Bakery · research · 14 min · ▓▓▓▓░░░  [Open]     │
├──────────────────────────────────────────────────────────────────────┤
│ Pipeline   Picked 3 · Building 1 · Preview 1 · Ready 1 · Sent 6 · Won 0 │
│ Recent     10:42 Oslo's Barbers revised · 10:05 Search "florist" +4 A  │
└──────────────────────────────────────────────────────────────────────┘
```

**Item kinds**

| Kind | Appears when | Primary action | Secondary |
|------|-------------|----------------|-----------|
| Photos | Gather finished and the photo checkpoint is on | Sort photos | Skip, use the automatic choice |
| Concept | Three concepts are ready | Choose a concept | Let the agent choose |
| Review | A preview or revision is ready | Review | Open the live site |
| Failed | A build or revise job failed | Retry from the failed step | View log, tear down |
| Send | The build is approved and no pitch has gone out | Open the composer | Mark as sent elsewhere |
| Reply | Status is "replied" and nothing has been logged since | Log the outcome: won, lost, follow up | Open the business |

**Behaviour**

- Ordered oldest first within kind. Kinds are ordered by how much they unblock: Failed, Photos, Concept, Review, Send, Reply.
- Each row is one line on desktop and a card on phone. The whole row is a link to the right tab. The action button does the action without opening the page where it can, for example Retry.
- An item leaves the inbox the moment its action is done. There is no "mark as read".
- The browser tab title shows the count, `(4) Acta`, so you can see it from another tab.
- Empty state: "Nothing needs you." with the next scheduled run time and a button to pick more leads.

**Discovery strip.** Beside the list: when the last search ran, new tier A and B leads this week, and your latest searches with what they found. Searching and picking are manual for now.

**Done when** every kind above can be produced from fixture data, each primary action works from the row, and the list updates within five seconds of a job finishing.

### 4.2 Pipeline board (feature 5)

**Purpose.** See every active business at once and move it along.

**Columns map to the real statuses.** The pasted list said "found, picked, building, preview, approved, sent, replied, won". The database has more statuses and keeps "approved" on the build, not the lead. The board maps them like this:

| Column | Shows leads where | Who moves cards in |
|--------|-------------------|--------------------|
| Picked | status `shortlisted` | You, from Leads |
| Building | status `building` | The pipeline only |
| Preview | status `preview_ready`, build not approved | The pipeline only |
| Ready to send | build state `approved` | You, by approving |
| Sent | status `contacted`, `followup_1`, `followup_2` | You, by sending |
| Replied | status `replied` | You |
| Won | status `won` | You |
| Closed | status `lost` or `do_not_contact`, collapsed by default | You |

"Found" is not a column. There are thousands of new leads, so the board header shows "1,240 new leads" as a link to the Leads page instead.

**Card content:** name, area, category, tier badge, a small hero screenshot once one exists, days in this column, and one badge for anything unusual: failed, revising, follow-up 2, email not allowed.

**Moving cards**

- Dropping a card into a column runs the same action as the matching button. Picked to Building starts a build, with the usage pre-flight. Preview to Ready approves. Ready to Sent opens the composer rather than marking it sent blind.
- Columns the pipeline owns, Building and Preview, are not drop targets. While dragging, invalid columns dim and valid ones highlight.
- Moving to Closed asks first, because it adds the business to the suppression list.
- Every card also has a "Move to" menu, which is the keyboard and screen-reader route. Drag and drop uses `@dnd-kit/core` for its keyboard sensor and announcements, not native HTML drag.
- Moves are optimistic with rollback, and show an undo toast for ten seconds.

**Filters:** text search, category, tier, area. Filters live in the address so a filtered board can be bookmarked.

**Done when** each allowed move calls the right endpoint, invalid moves are impossible, and the board works fully by keyboard.

### 4.3 Leads (supporting)

**Purpose.** Pick businesses to build. Deliberately minimal in version one.

- A sortable table: name, category, area, tier, score, website status, rating and reviews, channel, status.
- Filters: tier (A and B by default), category, area, status, text. Stored in the address.
- Row action: Pick or Unpick. Selecting several rows enables "Pick selected" and "Build selected", which queue in order.
- Clicking a row opens the business page on Overview.
- A search box runs `pipeline run "<query>"` as a job. Searching and picking are manual for now: the automatic sweep and the auto-picker are switched off.
- Virtualised rows, since the list can hold two thousand leads.

### 4.4 Business page

#### Overview

- Header: name, category, area, tier, status badge, links to Google Maps, current website and preview.
- The one next action, as a large button, matching the inbox item if there is one.
- Why it scored: the score reasons and the pitch hook, as plain sentences.
- Facts: phone, address, hours, rating, review count, Ltd or sole trader, channel.
- Timeline: every status change, job and review round, newest first.
- Danger zone at the bottom: tear down, mark do not contact.

#### Progress (feature 4)

**Purpose.** Know what the agent is doing and whether it is stuck, without reading raw logs.

```
gather ✓ ─ photos ✓ ─ research ✓ ─ concepts ✓ ─ BUILD ● ─ gates ─ deploy ─ evidence
Now: styling the gallery page (phase 4 of 6)            34 min · 112/250 turns
                                                         [Cancel build]
┌─ Plan ───────────────┐ ┌─ Live log ──────────────────────────────────┐
│ plan.md  (rendered)  │ │ 10:41 critic round 2: hero contrast fixed    │
│ concepts.md          │ │ 10:43 writing app/gallery/page.tsx           │
│ brief.md             │ │ ...                     [auto-scroll ● on]   │
└──────────────────────┘ └──────────────────────────────────────────────┘
```

- **Step rail** from the build steps, with the current one highlighted and checkpoints marked.
- **Now line:** the latest agent phase from the build events, in plain words.
- **Numbers:** elapsed time, turns used out of the cap, agent minutes, estimated cost, and the usage meter.
- **Documents:** brief, plan and concepts rendered as Markdown the moment they are written, each with "updated 2 minutes ago".
- **Live log** over the existing event stream. Auto-scroll stops when you scroll up and offers "Jump to latest". Log lines are filterable by level.
- **Stuck warning:** if no log line arrives for ten minutes, an amber notice says so and offers Cancel.
- **Cancel** asks first and says what happens: "The build stops. It can resume from research." Cancelling kills the job's process group.
- **Failed state:** the failed step, the error, the last thirty log lines, and two buttons: Retry from this step, and Start over. Gate failures show the gate table with values and thresholds.

#### Photos (feature 10, milestone 4)

**Purpose.** Stop bad photos reaching the design in thirty seconds of tapping.

- A grid of every gathered photo, with its source and size, and the automatic filter's verdict shown faintly.
- Each tile has three buttons: Keep, Drop, Hero. Keyboard: arrows move, K, D and H decide, Space opens a large view.
- One hero. Choosing a new hero demotes the old one to Keep.
- Dropping offers one-tap reasons: doorstep, clutter, close-up, low quality, not them. The reasons are counted across all businesses. When one reason keeps recurring, it becomes a rule in the gather filter, in line with principle 7.
- "Drop all unsorted" and "Keep all unsorted" for speed.
- A warning when fewer than six photos are kept: "The site will lean on type and colour."
- **Save and continue** writes the choices to `brand/curation.json` in the site folder and resumes the build. The agent treats dropped photos as unusable.

#### Concepts (feature 8, milestone 4)

**Purpose.** You choose the design direction, not a scoring rubric.

- Three cards side by side, stacked on phone. Each has a name, a short direction, palette swatches, the type pairing, the reference images it drew on, and a phone and desktop mock-up of its home-page hero.
- The agent's own preference is shown as a small "agent's pick" label, so you can see it without it being preselected.
- Clicking a mock-up opens it full size.
- **Choose this**, with an optional note such as "concept 2, but with concept 1's type".
- **None of these** regenerates three new concepts from a note. It starts an agent run, so it goes through the usage pre-flight.
- The choice is written to `concepts.md` under "Chosen", which the memory of previous sites already reads.

#### Review studio (feature 2)

**Purpose.** Look at the real site, pin precise comments, and approve or send back in one place.

```
Round 2 · [Phone][Tablet][Desktop] · Page: [Home ▾] · [Live | Annotate]   [Send back (3)] [Approve]
┌───────────────────────────────────────────┐ ┌─ Comments ───────────────┐
│                                           │ │ ① Home · phone            │
│        full-page screenshot               │ │   Hero text too small     │
│        with numbered pins  ①  ②           │ │   ☐ also a pipeline rule  │
│                                           │ │ ② Home · phone            │
│                                           │ │   Drop this photo         │
│                                           │ │ ③ General                 │
│                                           │ │   Warmer tone overall     │
└───────────────────────────────────────────┘ │ Gates: 11 pass · 0 fail   │
                                              │ Is it them? Is it good?   │
                                              └───────────────────────────┘
```

- **Devices:** phone at 390 pixels, tablet at 820 and desktop at 1440. The current contract has phone and desktop only, so tablet is added.
- **Live mode** shows the preview in a sandboxed frame at the device width, scaled to fit. If the site refuses to be framed, it says so and offers "Open in new tab" and a QR code to open it on your phone.
- **Annotate mode** shows the full-page screenshot for the chosen page and device. Click to drop a numbered pin, type, press Enter to save, Escape to cancel. Pins can be dragged to adjust and deleted until sent. "General note" adds a comment with no pin.
- **Comments panel:** unsent comments for this round, each with its page and device. Clicking a comment scrolls to its pin. Each has "also a pipeline rule".
- **Send back** crops the area around each pin with the pin drawn on, compiles the review note and queues a revise job. Flagged comments are also appended to `data/pipeline-rules.md`. The page moves to Progress.
- **Approve** marks the build approved and generates the delivery package. If unsent comments exist, it asks whether to discard them.
- **Screenshots** are retaken automatically at the end of every build and revision, and on demand with "Retake". Each round's set is kept, which is what makes Compare possible.
- **Reminders:** the gate summary and the two review questions, "Is it them? Is it good?", sit at the bottom of the panel.
- Keyboard: 1, 2 and 3 switch device, the square brackets move between pages, C enters comment mode.

#### Compare (feature 3)

**Purpose.** Check that every comment from the last round was actually acted on.

- Pick two rounds, the previous and latest by default, plus page and device.
- **Slider mode:** the two screenshots stacked, with a draggable divider. The divider is a proper slider: arrow keys move it, and it is announced to screen readers.
- **Flip mode:** Space swaps between before and after in place, which shows small changes better than a slider.
- **Side by side** for long pages. Pages of different height align at the top.
- The earlier round's pins show on the before side. Mark each one Fixed or Not fixed. Not fixed comments carry into the next round's draft automatically.
- **Done when** a two-round site can be checked comment by comment without leaving the tab.

#### Deliver (feature 6)

**Purpose.** Send the right message on the right channel, legally, in under a minute.

- **Compliance banner first,** in plain words. Green for a limited company: "Cold email allowed. Opt-out and postal address included." Amber for a sole trader: "No cold email. Use phone, walk-in or WhatsApp." When email is not allowed, the Email tab is locked and says why.
- **Sender check.** `config/offer.yaml` still has bracketed placeholders today. Until they are filled in, sending is blocked and the banner lists the missing fields. The postal address is required by PECR in every marketing email.
- **Tabs**
  - Email: To, Subject and Body, editable. "Open in Mail" downloads the `.eml` draft. "Copy" copies the body.
  - WhatsApp: the message with a character count, and "Open WhatsApp" using the business phone number.
  - Script: the call or walk-in script, printable.
  - Package: the preview link, the before-and-after image, a mock of the link preview as it appears in Messages and WhatsApp, the price and upsells, and the zip download.
- Edits save automatically, with a quiet "Saved" note. "Regenerate" asks first, because it overwrites your edits.
- **Mark as sent** asks for the channel and sets the status to contacted. It shows an undo toast.

#### Activity

- Every job, newest first: kind, target, label, status, duration, last log line.
- Filters by kind and status. Running and queued jobs are pinned to the top.
- Opening a job shows its full log, streamed live while it runs.
- Cancel for running and queued jobs, with a confirmation for agent jobs.
- On server restart, jobs whose process is gone are marked failed with the reason "server restarted". Jobs still alive are re-attached.

### 4.5 Usage meter (feature 7)

- **In the header on every page:** session and week bars, a red line at the stop threshold (70 percent by default), and the numbers. Hover shows when it was last read, and click refreshes it.
- **Pre-flight on every agent action:** build, revise and regenerate concepts.
  - More than ten points below the threshold: the action runs at once.
  - Within ten points: a dialog shows current usage, the threshold and what the action starts, with Start and Cancel.
  - At or over the threshold: blocked, with an explicit "Start anyway" for override.
- **The server enforces it too.** The start endpoints check usage and answer 409 with the reason unless the request carries an override. The UI is never the only guard.
- When usage can't be read, the meter says "unknown" and the pre-flight warns rather than blocks.

---

## 5. Shared components

Build these once and use them everywhere. Several already exist in `ui/src/components`.

| Component | Use |
|-----------|-----|
| Page shell, header, nav | Exists, trim nav to four items |
| Status, tier and build-state badges | Exist, one colour and label per value everywhere |
| Step rail | Exists as step dots, extend with checkpoints |
| Toast with undo | Exists, add the undo action |
| Confirm dialog | Exists, standardise wording: verb on the button, consequence in one sentence |
| Empty, loading and error states | Exist, use on every view |
| Markdown viewer | Exists, sanitised with DOMPurify |
| Image pin canvas | New: screenshot with pins, used by Review and Compare |
| Before-and-after slider | New |
| Device frame | New: scaled frame at a fixed width |
| Usage pre-flight | New: wraps any action that starts an agent |
| Live log viewer | New: event-stream log with auto-scroll and filter |
| Copy button | New: copies and confirms |

---

## 6. Visual design

Dark glass, after a reference dashboard, with Peritus's rules for colour. This is the operator's tool, not a client site, so a house style is right here.

- **Ground and glass.** A near-black ground with soft grey light from the top right and a faint contour texture. Containers are frosted glass: a translucent white fill, a backdrop blur, a hairline edge and a faint top highlight. One card at a time can be "lit" from its corner to show what's selected.
- **Monochrome, colour as marks.** Text and controls are white on glass. The primary button is a white pill with dark text. Green, amber and red appear only as small marks: a status dot, a tier dot, a usage meter, a review pin. Every coloured mark has a word beside it.
- **Type.** Inter. Page titles and big numbers are light weight with tight tracking, as in the reference. Body text is 14 pixels, chrome 13, tabular figures everywhere.
- **Shape.** Every control is a pill. Navigation is a row of pills along the top, the active one in glass. Cards have generous 20 to 28 pixel corners.
- **Phone layout.** The nav wraps under the logo, tables become cards, the board shows one column at a time, and the review studio stacks comments under the screenshot. Controls grow to 44 pixels under a touch pointer.
- **Motion** only to show cause and effect, under 200 milliseconds, and none under "reduce motion".

---

## 7. Architecture

**Stack, as already chosen in the partial work**

| Layer | Choice |
|-------|--------|
| Server | Hono on Node, `src/ui/server.ts`, started by `pnpm pipeline ui` |
| Browser app | React 19, Vite, React Router, TanStack Query, Tailwind 4, in `ui/` |
| Database | The existing SQLite file, in WAL mode so the CLI, scheduler and server can share it |
| Jobs | Child processes running `pnpm -s pipeline …` in their own process group, logging to `data/jobs/<id>.log` |
| Live updates | Server-sent events for job logs. Polling for everything else: every 2 seconds while a job runs, every 15 seconds when idle, paused while the tab is hidden |

**Serving.** `pnpm pipeline ui` serves the built app and the API on port 4321 and opens the browser. In development, Vite on port 5173 proxies to it, as configured.

**Job rules.** One agent job at a time, one search at a time, quick jobs immediately. Starting a second build for the same business while one runs answers 409.

**Security.** A local server that can spawn processes is worth protecting.

- Bind to `127.0.0.1` only, never `0.0.0.0`.
- Reject any request whose Host header isn't `127.0.0.1` or `localhost` on the right port. This blocks DNS rebinding.
- Reject any non-GET request whose Origin isn't the app itself. This blocks other websites posting to the server.
- Accept JSON bodies only, validated with zod at the edge.
- The files route resolves real paths and refuses anything outside the allowed folders.
- Markdown is sanitised before rendering. Preview frames are sandboxed.
- API responses never include keys or tokens from `.env`.

---

## 8. API and data changes

The contract in `src/ui/api-types.ts` covers most of version one. These are the additions.

| Change | Why |
|--------|-----|
| Add `tablet` to the device type, and take tablet screenshots at 820 pixels | Review studio has three devices |
| Keep screenshots per round in `acta/qa/rounds/<n>/` and add `GET /api/builds/:slug/rounds` | Compare needs every round, today each set overwrites the last |
| Add `resolved` and `rule` columns to the feedback table | Compare marks comments fixed, Review flags pipeline rules |
| Add `photos`, `concept` and `reply` to the inbox kinds, and order kinds as in 4.1 | New inbox items |
| Start endpoints check usage and accept `{ override: true }`, answering 409 with a reason otherwise | Server-side usage guard |
| Add `senderMissing: string[]` to the delivery | Composer blocks on unfilled sender details |
| `GET /api/builds/:slug/photos` and `PUT` with the choices | Photo curator |
| `GET /api/builds/:slug/concepts` and `POST …/choose` with an index and a note, `POST …/regenerate` with a note | Concept picker |
| `GET /api/board` returning active leads grouped by column | Board loads in one request |
| Origin and Host checks as middleware | Section 7 |

One new migration, `008_ui_review.sql`, holds the feedback columns. Everything else is files in the site folder, which keeps the site folder the record of the build.

---

## 9. Pipeline changes: the two checkpoints

Features 8 and 10 need the build to stop and wait for you. Today the agent scores three concepts and picks one itself, and photos are filtered automatically.

**New build states:** `awaiting_photos` after gather, and `awaiting_concept` after concepts are written.

**How the build pauses**

1. After gather, if the photo checkpoint is on, the build stops in `awaiting_photos`. The job ends successfully. Saving the choices queues `build <slug> --from research`.
2. The agent run is split at the concept step. The first run does research and writes three concepts, each with a static hero mock-up the pipeline screenshots, then stops in `awaiting_concept`. Choosing a concept queues the second run, which reads the choice from `concepts.md` and builds.

**Settings** in a new `checkpoints` block of the build config, both on by default:

```yaml
checkpoints:
  photos: true
  concept: true
```

**The unattended loop doesn't stall.** When the scheduler meets a paused build, it moves on to the next pick. Paused builds wait in the inbox until morning.

**The CLI gets the same controls,** so the UI stays a thin shell:

```
pnpm pipeline photos <slug> --keep 1,4,7 --hero 4
pnpm pipeline concept <slug> --choose 2 --note "warmer type"
```

---

## 10. Build order

Each milestone ends with something you can use on a real business.

**Milestone 1: the shell and picking**

- Server with security middleware, jobs, files and the existing endpoints.
- Layout with four nav items, usage meter and pre-flight.
- Leads table with pick and build. Activity with live logs and cancel.
- Inbox with Failed, Review and Send items. Business page with Overview.
- **Done when** you can pick a lead and start a build from the browser, watch it in Activity, and cancel it.

**Milestone 2: progress and review**

- Progress tab: step rail, now line, documents, live log, cancel, failed state.
- Review studio: three devices, live and annotate modes, pins, send back, approve.
- Per-round screenshots and the tablet size.
- **Done when** one real build has been reviewed with pinned comments, sent back, revised and reviewed again.

**Milestone 3: compare, deliver and the board**

- Compare tab with slider, flip and fixed marking.
- Deliver tab with compliance banner, sender check and mark as sent.
- Pipeline board with moves, menu alternative and filters. Reply items in the inbox.
- **Done when** the revised site has been compared, approved, delivered from the composer and appears under Sent on the board.

**Milestone 4: the checkpoints**

- Pipeline changes from section 9, with the CLI commands.
- Photos tab and Concepts tab. Photos and Concept items in the inbox.
- **Done when** one new business has gone through with photos you sorted and a concept you chose.

**Before starting:** commit or stash the workers' partial work on a branch, so version one starts from a known state.

---

## 11. Testing

| Level | What | How |
|-------|------|-----|
| Unit, server | Mappers, crop maths, review note compiling, board grouping, allowed moves, usage pre-flight, Host and Origin checks | Vitest, as today |
| API | Every endpoint against a temporary fixture database | Hono's request helper, no network |
| Components | Inbox kinds, board move menu, pin placing, slider keyboard, composer compliance lock, four states per view | Testing Library with fixture responses in `ui/src/mocks` |
| End to end | Pick, build, review, send back, compare, approve, deliver, mark sent | Playwright against the real server with a fake job runner that replays recorded logs, so no agent runs |
| Accessibility | Every page in light and dark | axe through Playwright, plus one keyboard-only pass per milestone |
| Real | One real business per milestone, as in each "done when" | By hand |

All of it runs offline in `pnpm test` except the real runs, matching the existing rule that tests never call paid APIs.

---

## 12. Not in version one

| Feature | When |
|---------|------|
| 9 Approve the plan | Version two, design control |
| 11 Brand check | Version two, design control |
| 12 Opportunity map, and the Searches page | Version two, finding. The partial map code is kept, not deleted |
| 13 Rich lead card | Version two, finding |
| 14 Call mode | Version two, selling |
| 15 Walk-in route | Version two, selling |
| 16 Follow-up reminders and full timeline | Version two, selling. Version one has the basic timeline only |
| 17 to 21 Owner approval page, clients area, money dashboard, settings page, notifications and command palette | After the first paying client |

---

## 13. Decisions to confirm

1. **Checkpoints on by default.** Recommended yes, both, with the unattended loop skipping paused builds. The cost is that overnight builds wait for you in the morning instead of finishing.
2. **Showing the agent's concept pick.** Recommended yes, as a small label, never preselected.
3. **Usage at the limit.** Recommended block with an explicit "Start anyway", rather than a hard block or a warning only.
