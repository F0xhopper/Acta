/**
 * Many businesses have a website that their Google listing doesn't link. For a lead with no site of its own on
 * Google, try the domains its name suggests (shinybarbers.co.uk, shiny-barbers.com, ...) and keep one only if the
 * page shows the listing's phone number or postcode, so a stranger's site or a parked domain never counts.
 * Their own site is the one place emails and photos can be taken from.
 */
import { lookup } from 'node:dns/promises';
import { fetchHomepage } from './fetch.js';
import { renderHtml } from './screenshot.js';
import { looksParked } from './classify.js';
import { loadScoring } from '../config.js';
import type { LeadRow } from '../db/types.js';

const DROP = new Set(['ltd', 'limited', 'llp', 'plc', 'the', 'and', 'co', 'uk', 'services', 'service']);

/** Domains a business's name suggests, most likely first. Pure. */
export function domainCandidates(name: string, max = 8): string[] {
  const words = name.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  const core = words.filter((w) => !DROP.has(w));
  if (!core.length) return [];
  // Long names: also try the first two or three words ("Onyx Residential Cleaning Services Birmingham" -> onyxresidentialcleaning).
  const stems = [...new Set([core.join(''), core.join('-'), core.slice(0, 3).join(''), core.slice(0, 2).join('')])]
    .filter((s) => s.replace(/-/g, '').length >= 5 && s.length <= 40);
  const out: string[] = [];
  for (const s of stems) for (const tld of ['.co.uk', '.com', '.uk']) out.push(`${s}${tld}`);
  return [...new Set(out)].slice(0, max);
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Does a page belong to this lead? Its phone number or postcode must be on it. Pure. */
export function pageMatchesLead(html: string, lead: Pick<LeadRow, 'phone_e164' | 'postcode'>): 'phone' | 'postcode' | null {
  const text = html.replace(/<[^>]+>/g, ' ');
  if (lead.phone_e164) {
    const national = `0${lead.phone_e164.replace(/^\+44/, '')}`;
    const d = digits(text.replace(/\+44\s*\(0\)\s*/g, '0').replace(/\+44\s*/g, '0'));
    if (national.length >= 10 && d.includes(digits(national))) return 'phone';
  }
  if (lead.postcode && text.toUpperCase().replace(/\s+/g, '').includes(lead.postcode.toUpperCase().replace(/\s+/g, ''))) return 'postcode';
  return null;
}

export interface FoundSite { url: string; matchedBy: 'phone' | 'postcode'; html: string }

interface Deps { fetch: typeof fetchHomepage; render: typeof renderHtml; resolves: (host: string) => Promise<boolean> }
const DEFAULT_DEPS: Deps = { fetch: fetchHomepage, render: renderHtml, resolves: async (h) => { try { await lookup(h); return true; } catch { return false; } } };

export async function findOwnSite(lead: LeadRow, deps: Deps = DEFAULT_DEPS): Promise<FoundSite | null> {
  const phrases = loadScoring().parked_phrases;
  for (const domain of domainCandidates(lead.name)) {
    if (!(await deps.resolves(domain))) continue;
    try {
      const f = await deps.fetch(`https://${domain}`, 12000);
      if (!f.body || (f.httpStatus ?? 500) >= 400 || looksParked(f.body, phrases)) continue;
      const url = f.finalUrl ?? `https://${domain}`;
      const by = pageMatchesLead(f.body, lead);
      if (by) return { url, matchedBy: by, html: f.body };
      // Builders like Wix put the phone number in by JavaScript: look again as a browser sees it.
      const r = await deps.render(url);
      const by2 = r.html ? pageMatchesLead(r.html, lead) : null;
      if (by2 && r.html) return { url: r.finalUrl ?? url, matchedBy: by2, html: r.html };
    } catch { /* next */ }
  }
  return null;
}
