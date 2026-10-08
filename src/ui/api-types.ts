/**
 * The contract between the local UI server (src/ui/server.ts) and the browser app (ui/).
 * Types only: the browser imports these with `import type`. Change both sides together.
 *
 * All endpoints are under /api, JSON in and out, served on http://127.0.0.1:4321 by `pnpm pipeline ui`.
 * Files (screenshots, photos, compare images, packages) are served under /files/<kind>/<slug>/<path>.
 * Errors are `{ error: string; code?: string }` with a 4xx or 5xx status. Code "usage" means the
 * usage guard refused an agent run; resend the same request with `override: true` to start anyway.
 */

export type Tier = 'A' | 'B' | 'C' | 'X';
export type PipelineStatus = 'new' | 'shortlisted' | 'building' | 'preview_ready' | 'contacted' | 'followup_1' | 'followup_2' | 'replied' | 'won' | 'lost' | 'do_not_contact';
export type BuildState =
  | 'picked' | 'gathered' | 'repo_ready' | 'awaiting_photos' | 'researched' | 'awaiting_concept' | 'built' | 'gated' | 'pushed' | 'deployed'
  | 'preview_ready' | 'approved' | 'revising' | 'failed' | 'torn_down' | 'live';
export type JobKind = 'build' | 'revise' | 'search' | 'deploy' | 'gather' | 'teardown' | 'shots' | 'concepts';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type Device = 'mobile' | 'tablet' | 'desktop';
export type BusinessTab = 'overview' | 'photos' | 'concepts' | 'progress' | 'review' | 'compare' | 'deliver';

/** GET /api/leads?tier=A,B&category=barber&status=new&area=Moseley&q=text  ->  LeadSummary[] (max 2000) */
export interface LeadSummary {
  slug: string;
  name: string;
  category: string;            // category key, e.g. "barber"
  categoryLabel: string;
  area: string;
  address: string | null;
  rating: number | null;
  reviews: number;
  phone: string | null;        // display format
  websiteStatus: string | null; // none | facebook_only | directory_only | platform_only | down | broken | live
  websiteUrl: string | null;
  tier: Tier | null;
  score: number | null;        // total 0-100
  opportunity: number | null;
  viability: number | null;
  channel: string | null;      // email | phone | walk_in | dm
  ltd: boolean;
  status: PipelineStatus;
  buildState: BuildState | null;
  hook: string;                // one-line pitch hook
  reasons: string[];
  mapsUrl: string | null;
  sourceQuery: string;
  discoveredAt: string;
}

/** GET /api/leads/:slug  ->  LeadDetail */
export interface LeadDetail extends LeadSummary {
  description: { text: string; source: string };
  hours: string[];
  reviewsList: { rating: number | null; text: string; author: string | null; when: string | null }[];
  audit: { lhPerf: number | null; lhSeo: number | null; viewport: boolean | null; https: boolean | null; builder: string | null; copyrightYear: number | null } | null;
  currentSiteShot: string | null;   // /files URL of their current site on a phone, if any
  timeline: TimelineEntry[];        // newest first
  build: BuildSummary | null;
  nextAction: NextAction | null;    // the one thing to do next for this business
}

export interface TimelineEntry { at: string; kind: 'status' | 'build' | 'job' | 'review' | 'note'; text: string; level?: 'info' | 'warn' | 'error' }
export interface NextAction { label: string; tab: BusinessTab; kind: InboxKind | 'build' | 'wait' }

/** One step on the build rail. Checkpoints are the steps that wait for you. */
export interface RailStep { key: string; label: string; checkpoint: boolean; status: 'done' | 'current' | 'waiting' | 'failed' | 'todo' | 'skipped' }

/** GET /api/builds  ->  BuildSummary[] */
export interface BuildSummary {
  slug: string;
  name: string;
  state: BuildState;
  failedStep: string | null;
  lastError: string | null;
  previewUrl: string | null;
  repoUrl: string | null;
  evidenceUrl: string | null;       // /files URL of compare.png
  heroShotUrl: string | null;       // /files URL of acta/qa/hero-mobile.png
  agentMinutes: number | null;
  agentTurns: number | null;
  agentCostUsd: number | null;
  updatedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  rail: RailStep[];
  activeJobId: number | null;
  rounds: number;                   // review rounds sent so far
}

/** GET /api/builds/:slug  ->  BuildDetail */
export interface BuildDetail extends BuildSummary {
  events: { at: string; step: string | null; level: string; message: string }[]; // newest last, up to 300
  gates: { name: string; pass: boolean; value?: string | number | null; threshold?: string | null; details?: string[] }[] | null;
  pages: PageShots[];               // latest full-page screenshots for annotating
  docs: { name: string; url: string; updatedAt: string }[]; // board, plan, concepts, brief, build-log as /files URLs
  agent: AgentProgress | null;
  feedback: FeedbackItem[];         // unsent comments plus the history of sent rounds
  delivery: DeliverySummary | null;
  maxMinutes: number;
  maxTurns: number;
  startedAt: string | null;         // when the active job started
  shotsTaking: boolean;
}

export interface PageShots { path: string; label: string; shots: Partial<Record<Device, string>> }

/** What the agent has written so far, read from the files it leaves in acta/ and its git history. */
export interface AgentProgress {
  phases: { key: string; label: string; done: boolean }[];
  current: string | null;           // label of the first phase not done
  lastCommit: { message: string; at: string } | null;
}

/** A comment pinned to a point on a page screenshot, or a general note. */
export interface FeedbackItem {
  id: number;
  slug: string;
  page: string | null;               // e.g. "/gallery"; null = whole site
  device: Device | null;
  x: number | null;                  // 0-1 fraction of the screenshot width
  y: number | null;                  // 0-1 fraction of the screenshot height
  text: string;
  cropUrl: string | null;            // /files URL of the cropped region image, made on send
  round: number | null;              // null = not sent yet
  rule: boolean;                     // also a pipeline rule
  resolved: 'fixed' | 'not_fixed' | null;
  createdAt: string;
}
/** POST /api/builds/:slug/feedback  body: NewFeedback  ->  FeedbackItem */
export interface NewFeedback { page: string | null; device: Device | null; x: number | null; y: number | null; text: string; rule?: boolean }
/** PATCH /api/feedback/:id  body Partial<{ text; x; y; rule; resolved }>  ->  FeedbackItem.  DELETE /api/feedback/:id  ->  { ok: true } */
/** POST /api/builds/:slug/feedback/send  body { override?: boolean }  ->  Job   (compiles unsent items with crops, queues a revise job) */

/** GET /api/builds/:slug/rounds  ->  Round[]   (round 0 is the first build; round n is after the nth revision) */
export interface Round { round: number; takenAt: string; pages: PageShots[] }

/** GET /api/builds/:slug/photos  ->  PhotoSet.  PUT body { choices: PhotoChoice[]; resume: boolean; override?: boolean }  ->  { ok; message; job: Job | null } */
export interface PhotoSet {
  photos: Photo[];
  waiting: boolean;                  // the build is paused for you
  curated: boolean;                  // you've saved a choice before
  reasons: string[];                 // the one-tap drop reasons
  dropStats: { reason: string; count: number }[]; // across every site, most common first
}
export interface Photo { path: string; url: string; source: string; width: number; height: number; alt: string | null; choice: 'keep' | 'drop' | 'hero' | null; reason: string | null }
export interface PhotoChoice { path: string; choice: 'keep' | 'drop' | 'hero'; reason?: string | null }
/** POST /api/builds/:slug/photos/skip  ->  { ok; message; job }   (keep the automatic choice and continue) */

/** GET /api/builds/:slug/concepts  ->  ConceptSet */
export interface ConceptSet {
  concepts: Concept[];
  waiting: boolean;
  chosen: { index: number | null; name: string; note: string | null } | null;
  agentPick: number | null;
  mdUrl: string | null;
}
export interface Concept { index: number; name: string; idea: string; body: string; palette: string[]; score: number | null; shots: Partial<Record<Device, string>> }
/** POST /api/builds/:slug/concepts/choose  body { index: number | null; note?: string; override?: boolean }  ->  { ok; message; job }  (index null = let the agent's pick stand) */
/** POST /api/builds/:slug/concepts/regenerate  body { note: string; override?: boolean }  ->  Job */

/** POST /api/leads/:slug/pick | /unpick  ->  Ok */
/** POST /api/leads/:slug/status  body { status: PipelineStatus; note?: string }  ->  Ok */
/** POST /api/builds/:slug/start  body { sandbox?: boolean; force?: boolean; from?: string; override?: boolean }  ->  Job */
/** POST /api/builds/:slug/approve  ->  Ok & { delivery: DeliverySummary | null } */
/** POST /api/builds/:slug/teardown  ->  Job.   POST /api/builds/:slug/shots  ->  Job */
/** POST /api/search  body { query: string }  ->  Job   (pipeline run "<query>") */
export interface Ok { ok: boolean; message: string }

/** GET /api/jobs?limit=50  ->  Job[] newest first.  GET /api/jobs/:id  ->  Job.  POST /api/jobs/:id/cancel  ->  Job */
/** GET /api/jobs/:id/log  ->  text/event-stream: one `data:` line per log line, then `event: end` with the final Job JSON */
export interface Job {
  id: number;
  kind: JobKind;
  target: string | null;            // slug or query
  label: string;                    // human description, e.g. "Build Oslo's Barbers Ltd"
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  lastLine: string | null;          // latest log line, for list views
}

/** GET /api/deliveries/:slug  ->  Delivery (404 when none).  POST  ->  Delivery (regenerate).  PUT body Partial<Pick<Delivery,'subject'|'body'|'whatsapp'>>  ->  Delivery */
/** POST /api/deliveries/:slug/sent  body { channel }  ->  Ok (status contacted).  POST /api/deliveries/:slug/unsent  ->  Ok (undo) */
export interface DeliverySummary { slug: string; createdAt: string; channel: string; emailAllowed: boolean; zipUrl: string; sentAt: string | null; sentChannel: string | null }
export interface Delivery extends DeliverySummary {
  to: string | null;                // business email if known
  phone: string | null;             // display format
  phoneE164: string | null;
  subject: string;
  body: string;                     // plain-text email body
  whatsapp: string;                 // short message with the link
  script: string;                   // call or walk-in script for the channel
  ownerQuestions: string[];
  previewUrl: string | null;
  compareUrl: string | null;        // /files URL
  ogUrl: string | null;             // link preview image URL on the live site
  emlUrl: string;                   // /files URL of a .eml draft that opens in Mail
  price: { build: number; monthly: number; currency: 'GBP' };
  upsells: string[];
  complianceNote: string;
  senderMissing: string[];          // sender fields in config/offer.yaml still holding [placeholders]
}

/** GET /api/board  ->  Board */
export type BoardColumn = 'picked' | 'building' | 'preview' | 'ready' | 'sent' | 'replied' | 'won' | 'closed';
export interface BoardCard {
  slug: string; name: string; area: string; categoryLabel: string; tier: Tier | null; score: number | null;
  status: PipelineStatus; buildState: BuildState | null; heroShotUrl: string | null;
  since: string;                    // when it entered this column, roughly
  badge: { text: string; tone: 'bad' | 'warn' | 'info' } | null;
  moves: BoardColumn[];             // columns it may be moved to
}
export interface Board { columns: Record<BoardColumn, BoardCard[]>; newLeads: number }
/** POST /api/board/move  body { slug; to: BoardColumn; override?: boolean; note?: string }  ->  Ok & { job?: Job } */

/** GET /api/summary  ->  Summary (the Inbox) */
export type InboxKind = 'failed' | 'photos' | 'concept' | 'review' | 'send' | 'followup' | 'reply';
export interface InboxItem { kind: InboxKind; slug: string; name: string; detail: string; at: string; tab: BusinessTab }
export interface Summary {
  needsYou: InboxItem[];
  counts: Record<BoardColumn, number> & { newLeads: number };
  running: (Job & { slug: string | null; step: string | null })[];
  recent: { at: string; slug: string | null; name: string | null; message: string; level: string }[];
  discovery: Discovery;
  usage: Usage | null;
}

/** Where discovery stands: your recent searches and what they found. Searching and picking are manual. */
export interface Discovery {
  lastRunAt: string | null;         // last search of any kind
  newThisWeek: { total: number; tierAB: number };
  recentSearches: { query: string; lastRunAt: string | null; found: number; tierAB: number }[];
}

/** GET /api/usage  ->  Usage | null (cached two minutes, refreshed in the background) */
export interface Usage { session: number | null; week: number | null; stopAt: number; warnAt: number; at: string }

/** GET /api/meta  ->  Meta */
export interface Meta { categories: { key: string; label: string }[]; areas: string[]; senderMissing: string[]; checkpoints: { photos: boolean; concept: boolean } }

/** GET /api/outreach  ->  OutreachStatus.  POST /api/outreach/dns  ->  re-checks DNS.  POST /api/outreach/replies  ->  { checked; matched; error } */
export type Transport = 'manual' | 'test' | 'proton' | 'resend';
export interface OutreachStatus {
  transport: Transport;
  transportLabel: string;
  from: string | null;
  sendsForReal: boolean;            // proton or resend
  canSendNow: boolean;              // the Send button can be used (test mode counts)
  problems: string[];               // why real sending isn't ready, in plain words
  cap: { today: number; sentToday: number; left: number; warmupWeek: number };
  dns: { name: string; ok: boolean; detail: string }[] | null;
  followUps: { auto: boolean; days: number[]; maxContacts: number };
  replies: { check: boolean; lastCheckedAt: string | null; lastError: string | null; matched: number };
}
export interface OutreachMessage {
  id: number; direction: 'out' | 'in'; kind: 'pitch' | 'followup_1' | 'followup_2' | 'reply'; channel: string;
  to: string | null; from: string | null; subject: string | null; body: string | null;
  transport: Transport | 'imap'; status: 'sent' | 'logged' | 'written' | 'failed' | 'received'; error: string | null; at: string;
}
export interface FollowUp { slug: string; name: string; n: 1 | 2; dueAt: string; overdue: boolean; channel: string; to: string | null; canEmail: boolean; subject: string; body: string; last: boolean }
/** GET /api/leads/:slug/outreach  ->  LeadOutreach */
export interface LeadOutreach { messages: OutreachMessage[]; followUp: FollowUp | null; nextTouchAt: string | null; pitchBlockers: string[] }
/** POST /api/deliveries/:slug/send  body { override? }  ->  Ok & { message: OutreachMessage }   (409 code "cap" when today's warm-up limit is used) */
/** POST /api/leads/:slug/followup  body { mode: 'send' | 'logged'; subject?; body?; channel?; override? }  ->  Ok & { message: OutreachMessage } */
