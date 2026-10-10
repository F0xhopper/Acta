/**
 * The email step of discovery, run after each search is audited and scored: for every lead in it, look for their own
 * site when Google links none and read it for contacts, then search the open web for leads still without an email.
 * Only tiers worth pitching get the web search (it's a Claude run), limited companies first, and it stops at the
 * usage guard. Each lead is searched once; `pnpm pipeline web-emails --all` looks again.
 */
import { findContacts } from '../audit/index.js';
import { closeBrowser } from '../audit/screenshot.js';
import { searchAndStoreWebEmail, webEmailQueue } from '../audit/web-email.js';
import { overLimit, readUsage, usageThreshold } from '../build/usage.js';
import { findCategory } from '../config.js';
import { fullLeads } from '../db/queries.js';
import { loadPick } from '../pick/config.js';
import { outcomeStats } from '../pick/queries.js';
import { learning, tradeValue } from '../pick/trade.js';
import { reachOf } from '../score/reach.js';
import { scoreAll } from '../score/score.js';
import { log } from '../util/log.js';
import { loadAutomation } from './automation.js';

export interface EmailStep { sitesFound: number; webSearched: number; webFound: number; stopped: string | null }

export async function findEmails(opts: { query?: string; tiers?: string[]; web?: boolean } = {}): Promise<EmailStep> {
  const out: EmailStep = { sitesFound: 0, webSearched: 0, webFound: 0, stopped: null };
  const hasEmail = (f: ReturnType<typeof fullLeads>[number]) => !!reachOf(f, findCategory(f.lead.category_key)).email;
  try {
    // Their own site: found by name when the listing links none, and read for emails and socials.
    for (const f of fullLeads({ query: opts.query }).filter((x) => !x.lead.site_search_at && !['live', 'broken'].includes(x.audit?.website_status ?? ''))) {
      if ((await findContacts(f)).foundSite) out.sitesFound++;
    }
    scoreAll(opts.query ? { query: opts.query } : {});
    if (opts.web === false || !loadAutomation().webEmail) return out;
    // Still no email: the open web, for the leads an email would actually unlock. Cold email is only allowed to a
    // limited company, and a Claude run per lead is only worth it in a trade that pays (config/pick.yaml web_email).
    const pick = loadPick();
    const learn = learning(outcomeStats());
    const worth = (f: ReturnType<typeof fullLeads>[number]) => (!pick.web_email.ltd_only || f.ch?.match_confidence === 'high')
      && tradeValue(findCategory(f.lead.category_key), learn, pick).value >= pick.web_email.min_trade_value;
    for (const [i, f] of webEmailQueue(fullLeads({ query: opts.query, tiers: opts.tiers ?? ['A', 'B', 'C'] }).filter(worth), hasEmail).entries()) {
      if (i % 5 === 0) { const u = await readUsage().catch(() => null); const over = u ? overLimit(u, usageThreshold()) : null; if (over) { out.stopped = `Claude usage ${over}`; break; } }
      const r = await searchAndStoreWebEmail(f);
      out.webSearched++;
      if (r.email) { out.webFound++; log.info(`web email for ${f.lead.name}: ${r.email} (${r.note})`); }
    }
  } finally { await closeBrowser(); }
  scoreAll(opts.query ? { query: opts.query } : {});
  log.info(`emails${opts.query ? ` for "${opts.query}"` : ''}: ${out.sitesFound} own sites found, ${out.webFound} of ${out.webSearched} found on the web${out.stopped ? ` (stopped: ${out.stopped})` : ''}`);
  return out;
}
