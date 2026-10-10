/**
 * A deeper look for an email when their own site has none: a short headless Claude run that searches the open web
 * (booking and ordering sites, local directories and news that turn up in search) and names the page the address is
 * on. Facebook, Instagram and Google Maps are never opened, they ban scraping; the UI links to them for a look by eye.
 * Nothing the agent says is trusted: the page is fetched again here and kept only if it shows both the address and
 * the lead's phone number or postcode, and the address isn't the site's own (a platform's support mailbox).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.js';
import { openDb } from '../db/index.js';
import type { FullLead, LeadRow } from '../db/types.js';
import { isoNow } from '../util/dates.js';
import { cleanEnv } from '../build/agent.js';
import { run } from '../build/exec.js';
import { fetchHomepage } from './fetch.js';
import { renderHtml } from './screenshot.js';
import { extractContacts } from './contacts.js';
import { pageMatchesLead } from './find-site.js';

export interface WebEmail { email: string | null; url: string | null; note: string }
type Lead = Pick<LeadRow, 'name' | 'address' | 'postcode' | 'phone_e164' | 'website_url' | 'found_site_url' | 'type_label' | 'category_raw'>;

const NOT_SOURCES = /(^|\.)(facebook\.com|fb\.com|instagram\.com|google\.[a-z.]+|goo\.gl|yell\.com)$/i;
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

export function webEmailPrompt(lead: Lead, companyName: string | null): string {
  const national = lead.phone_e164 ? `0${lead.phone_e164.replace(/^\+44/, '')}` : null;
  return [
    'Find a public email address for this UK small business. It is for a one-off business enquiry.',
    '',
    `Name: ${lead.name}`,
    companyName ? `Registered company: ${companyName}` : null,
    `Trade: ${lead.type_label ?? lead.category_raw ?? 'unknown'}`,
    lead.address ? `Address: ${lead.address}` : null,
    national ? `Phone: ${national}` : null,
    lead.website_url || lead.found_site_url ? `Website: ${lead.found_site_url ?? lead.website_url}` : 'Website: none known',
    '',
    'Search the open web: their own site if they have one, booking and ordering sites (Booksy, Treatwell, Fresha, Just Eat, Deliveroo, Uber Eats, OpenTable and the like), local directories, food and trade listings, local news, event pages. Try a few searches: the name with the town, the name with the postcode, the phone number on its own, the name with "email" or "@gmail.com".',
    'Do not open facebook.com, instagram.com, google.com/maps or yell.com: they forbid scraping. A search result snippet from them does not count.',
    'Only report an address that a page you opened shows for this business (with its name, phone or postcode on the same page). Never guess or build an address (no info@ + their domain). A platform\'s own support address is not theirs.',
    '',
    'Reply with JSON only, no prose: {"email": "<address or null>", "source_url": "<the page it is on, or null>", "note": "<one short sentence: where it was, or what you tried>"}',
  ].filter((l): l is string => l !== null).join('\n');
}

/** The JSON object in the agent's reply. Pure. */
export function parseWebEmailReply(text: string): WebEmail | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { email?: unknown; source_url?: unknown; note?: unknown };
    const email = typeof o.email === 'string' && o.email.includes('@') ? o.email.trim().toLowerCase() : null;
    const url = typeof o.source_url === 'string' && /^https?:\/\//.test(o.source_url) ? o.source_url.trim() : null;
    return { email, url, note: typeof o.note === 'string' ? o.note.slice(0, 300) : '' };
  } catch { return null; }
}

/** Does this page back the claim? It shows the address and the lead's phone or postcode, and isn't a page we may not read. Pure. */
export function verifyEmailPage(html: string, pageUrl: string, email: string, lead: Lead): { ok: boolean; why: string } {
  const host = hostOf(pageUrl);
  if (!host || NOT_SOURCES.test(host)) return { ok: false, why: `${host || 'no page'} can't be used as a source` };
  const own = [lead.website_url, lead.found_site_url].filter((u): u is string => !!u).map(hostOf);
  const domain = email.split('@')[1] ?? '';
  if (!own.includes(host) && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`))) return { ok: false, why: `${email} is ${host}'s own address` };
  const shown = extractContacts(html, pageUrl).emails.includes(email) || html.toLowerCase().includes(email);
  if (!shown) return { ok: false, why: `${email} isn't on ${host}` };
  const by = pageMatchesLead(html, lead);
  if (!by) return { ok: false, why: `${host} doesn't show their phone number or postcode` };
  return { ok: true, why: `on ${host} with their ${by}` };
}

interface Deps {
  ask: (prompt: string) => Promise<string>;
  fetch: typeof fetchHomepage;
  render: typeof renderHtml;
}

const WORK_DIR = join(DATA_DIR, 'cache', 'web-email');
const askClaude = async (prompt: string): Promise<string> => {
  mkdirSync(WORK_DIR, { recursive: true });
  const r = await run('claude', ['-p', prompt, '--output-format', 'json', '--model', 'sonnet', '--max-turns', '16', '--allowedTools', 'WebSearch,WebFetch'],
    { cwd: WORK_DIR, env: cleanEnv(), inheritEnv: false, timeoutMs: 5 * 60_000 });
  try { return String((JSON.parse(r.stdout.trim()) as { result?: unknown }).result ?? ''); } catch { return r.stdout; }
};
const DEFAULT_DEPS: Deps = { ask: askClaude, fetch: fetchHomepage, render: renderHtml };

/** Search the open web for their email and check it against the page it came from. */
export async function searchWebEmail(lead: Lead, companyName: string | null, deps: Deps = DEFAULT_DEPS): Promise<WebEmail> {
  const reply = parseWebEmailReply(await deps.ask(webEmailPrompt(lead, companyName)));
  if (!reply) return { email: null, url: null, note: 'The search gave no answer.' };
  if (!reply.email || !reply.url) return { email: null, url: null, note: reply.note || 'Nothing found.' };
  let why = '';
  try {
    const f = await deps.fetch(reply.url, 15000);
    const base = f.finalUrl ?? reply.url;
    if (f.body && (f.httpStatus ?? 500) < 400) {
      const v = verifyEmailPage(f.body, base, reply.email, lead);
      if (v.ok) return { email: reply.email, url: base, note: v.why };
      why = v.why;
    }
    // Listings built in the browser (booking sites): look again as a browser sees it.
    const r = await deps.render(base);
    if (r.html) {
      const v = verifyEmailPage(r.html, r.finalUrl ?? base, reply.email, lead);
      if (v.ok) return { email: reply.email, url: r.finalUrl ?? base, note: v.why };
      why = v.why;
    }
  } catch { why = `couldn't open ${reply.url}`; }
  return { email: null, url: null, note: `Found ${reply.email} but couldn't confirm it: ${why || 'the page did not load'}.` };
}

/** Search for one lead and store what's found (or that nothing was), so the next batch skips it. */
export async function searchAndStoreWebEmail(full: FullLead): Promise<WebEmail> {
  const r = await searchWebEmail(full.lead, full.ch?.match_confidence === 'high' ? full.ch.company_name : null);
  openDb().prepare('UPDATE leads SET web_email = ?, web_email_url = ?, email_search_at = ? WHERE id = ?').run(r.email, r.url, isoNow(), full.lead.id);
  return r;
}

/** Leads worth a web search, best first: no email yet, limited companies first (an email means cold email is allowed), then by score. Pure. */
export function webEmailQueue(leads: FullLead[], hasEmail: (f: FullLead) => boolean, opts: { again?: boolean } = {}): FullLead[] {
  return leads
    .filter((f) => !hasEmail(f) && (opts.again || !f.lead.email_search_at))
    .sort((a, b) => Number(b.ch?.match_confidence === 'high') - Number(a.ch?.match_confidence === 'high') || (b.score?.total ?? -1) - (a.score?.total ?? -1));
}
