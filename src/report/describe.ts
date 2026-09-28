import type { FullLead } from '../db/types.js';

export interface ReviewSnippet { rating: number | null; text: string; when: string | null; at: string | null; author: string | null }

export function reviewsOf(r: FullLead): ReviewSnippet[] {
  try { return r.lead.reviews_json ? (JSON.parse(r.lead.reviews_json) as ReviewSnippet[]) : []; } catch { return []; }
}

/** First sentence of a good review that says something specific, for use as a quote. */
export function bestQuote(reviews: ReviewSnippet[]): ReviewSnippet & { quote: string } | null {
  const candidates = reviews
    .filter((r) => (r.rating ?? 0) >= 4 && r.text)
    .map((r) => {
      const first = r.text.split(/(?<=[.!?])\s+/).find((sn) => sn.length >= 30) ?? r.text;
      const quote = first.length > 160 ? `${first.slice(0, 157).replace(/\s+\S*$/, '')}…` : first;
      // Prefer quotes that mention the work over generic praise.
      const specific = /\b(fix|fitted|install|repair|boiler|fade|cut|trim|beard|clean|job|work|service|session|train|coach|sold|let|house|property|kitchen|bathroom|garden|roof|wiring|lesson)\w*/i.test(quote) ? 1 : 0;
      return { ...r, quote, rank: specific * 1000 + Math.min(quote.length, 160) };
    })
    .sort((a, b) => b.rank - a.rank);
  return candidates[0] ?? null;
}

export type DescriptionSource = 'google' | 'website' | 'reviews' | 'listing';

/** What the business does, in a sentence or two, and where that came from. */
export function describeLead(r: FullLead): { text: string; source: DescriptionSource } {
  if (r.lead.editorial_summary) return { text: r.lead.editorial_summary, source: 'google' };
  if (r.audit?.site_description) return { text: r.audit.site_description, source: 'website' };
  const type = r.lead.type_label ?? r.lead.category_raw;
  const base = `${type.charAt(0).toUpperCase()}${type.slice(1)} in ${r.lead.area}`;
  const q = bestQuote(reviewsOf(r));
  if (q) return { text: `${base}. A customer says: “${q.quote}”`, source: 'reviews' };
  return { text: `${base}.`, source: 'listing' };
}

export const SOURCE_LABEL: Record<DescriptionSource, string> = { google: 'Google', website: 'their website', reviews: 'Google reviews', listing: 'Google listing' };
