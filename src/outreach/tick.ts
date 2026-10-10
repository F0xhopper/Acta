/**
 * What outreach does on its own while the UI server runs, and only what config/outreach.yaml switches on:
 * check for replies every few minutes, and send due email follow-ups inside the send window, within the
 * warm-up cap, one at a time with a gap between them. Pitches are never sent automatically.
 */
import { log } from '../util/log.js';
import { loadOutreach, sendsForReal } from './config.js';
import { capState, doFollowUp, dueFollowUps, sendProblems } from './index.js';
import { checkReplies } from './replies.js';
import { opensConfigured, refreshOpens } from './opens.js';
import { inWindow } from './rules.js';

const GAP_MS = 5 * 60_000; // space automatic sends out; a burst looks like a bulk sender
let lastReplies = 0;
let lastOpens = 0;
let lastAutoSend = 0;
let busy = false;

export async function outreachTick(now = new Date()) {
  if (busy) return;
  busy = true;
  try {
    const cfg = loadOutreach();
    // Preview opens, on the same cadence as replies: cheap, and "opened but no reply" is worth knowing the same day.
    if (opensConfigured() && now.getTime() - lastOpens >= cfg.replies.every_minutes * 60_000) {
      lastOpens = now.getTime();
      const o = await refreshOpens();
      if (o.errors.length) log.warn(`outreach: opens ${o.errors[0]}`);
    }
    if (cfg.replies.check && now.getTime() - lastReplies >= cfg.replies.every_minutes * 60_000) {
      lastReplies = now.getTime();
      const r = await checkReplies();
      if (r.matched.length) log.info(`outreach: ${r.matched.length} repl${r.matched.length === 1 ? 'y' : 'ies'} matched (${r.matched.map((m) => `${m.name}: ${m.kind}`).join(', ')})`);
      if (r.error) log.warn(`outreach: ${r.error}`);
    }
    if (cfg.follow_ups.auto && sendsForReal(cfg.transport) && inWindow(cfg.send_window, now) && now.getTime() - lastAutoSend >= GAP_MS) {
      if ((await sendProblems(cfg)).length || capState(cfg, now).left <= 0) return;
      const next = dueFollowUps(now).find((f) => f.canEmail);
      if (next) {
        lastAutoSend = now.getTime();
        try { await doFollowUp(next.slug, { mode: 'send' }); log.info(`outreach: follow-up ${next.n} sent to ${next.name}`); }
        catch (e) { log.warn(`outreach: follow-up to ${next.name} not sent: ${(e as Error).message}`); }
      }
    }
  } finally { busy = false; }
}

export function startOutreachTicker(): NodeJS.Timeout {
  return setInterval(() => { void outreachTick(); }, 60_000);
}
