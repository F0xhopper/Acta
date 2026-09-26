import { nameSimilarity } from '../util/slug.js';
import { outwardCode } from './places.js';
import type { CHSearchItem } from './companies-house.js';
import type { MatchConfidence } from '../db/types.js';

export interface MatchResult { confidence: MatchConfidence; item?: CHSearchItem; similarity: number }

/**
 * Decide whether a Companies House search result is this business.
 * high  : similarity >= 0.85 and same outward postcode, or >= 0.95 both in the B area, or >= 0.85 both in B with an Ltd hint on the site.
 * medium: similarity >= 0.85 without postcode agreement.
 * low   : similarity >= 0.7.
 */
export function matchCompany(lead: { name: string; outward_code: string | null }, items: CHSearchItem[], ltdHint = false): MatchResult {
  let best: MatchResult = { confidence: 'none', similarity: 0 };
  const leadOut = lead.outward_code?.toUpperCase() ?? null;
  const leadInB = !!leadOut && /^B\d/.test(leadOut);
  for (const item of items) {
    if (item.company_status && item.company_status !== 'active') continue;
    const sim = nameSimilarity(lead.name, item.title);
    if (sim < 0.7) continue;
    const itemOut = outwardCode(item.address?.postal_code ?? null);
    const samePostcode = !!leadOut && !!itemOut && leadOut === itemOut;
    const itemInB = !!itemOut && /^B\d/.test(itemOut);
    let confidence: MatchConfidence = 'low';
    if ((sim >= 0.85 && samePostcode) || (sim >= 0.95 && leadInB && itemInB) || (sim >= 0.85 && leadInB && itemInB && ltdHint)) confidence = 'high';
    else if (sim >= 0.85) confidence = 'medium';
    const rank = { high: 3, medium: 2, low: 1, none: 0 };
    if (rank[confidence] > rank[best.confidence] || (rank[confidence] === rank[best.confidence] && sim > best.similarity)) {
      best = { confidence, item, similarity: sim };
    }
  }
  return best;
}
