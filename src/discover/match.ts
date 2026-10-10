import { nameSimilarity } from '../util/slug.js';
import { outwardCode } from './places.js';
import type { CHSearchItem } from './companies-house.js';
import type { MatchConfidence } from '../db/types.js';

export interface MatchResult { confidence: MatchConfidence; item?: CHSearchItem; similarity: number; via?: 'sic' }

/** Whether a company's SIC codes include one of the trade's (config/categories.yaml `sic`). Pure. */
export function sicAgrees(companySic: string[] | null | undefined, tradeSic: string[] | null | undefined): boolean {
  if (!companySic?.length || !tradeSic?.length) return false;
  const want = new Set(tradeSic.map((s) => s.trim()));
  return companySic.some((s) => want.has(s.trim()));
}

/**
 * A medium match (the name agrees, the postcode doesn't: registered offices are often an accountant's) becomes high
 * when the company's SIC codes say it does this trade. Pure.
 */
export function promoteBySic(match: MatchResult, companySic: string[] | null | undefined, tradeSic: string[] | null | undefined): MatchResult {
  if (match.confidence !== 'medium' || !sicAgrees(companySic, tradeSic)) return match;
  return { ...match, confidence: 'high', via: 'sic' };
}

/**
 * Decide whether a Companies House search result is this business.
 * high  : similarity >= 0.85 and same outward postcode, or >= 0.95 both in the same postcode area (B, CV, M...), or >= 0.85 same area with an Ltd hint on the site.
 * medium: similarity >= 0.85 without postcode agreement.
 * low   : similarity >= 0.7.
 */
export function matchCompany(lead: { name: string; outward_code: string | null }, items: CHSearchItem[], ltdHint = false): MatchResult {
  let best: MatchResult = { confidence: 'none', similarity: 0 };
  const leadOut = lead.outward_code?.toUpperCase() ?? null;
  const areaOf = (out: string | null) => out?.match(/^[A-Z]{1,2}/)?.[0] ?? null;
  const leadArea = areaOf(leadOut);
  for (const item of items) {
    if (item.company_status && item.company_status !== 'active') continue;
    const sim = nameSimilarity(lead.name, item.title);
    if (sim < 0.7) continue;
    const itemOut = outwardCode(item.address?.postal_code ?? null);
    const samePostcode = !!leadOut && !!itemOut && leadOut === itemOut;
    const sameArea = !!leadArea && leadArea === areaOf(itemOut);
    let confidence: MatchConfidence = 'low';
    if ((sim >= 0.85 && samePostcode) || (sim >= 0.95 && sameArea) || (sim >= 0.85 && sameArea && ltdHint)) confidence = 'high';
    else if (sim >= 0.85) confidence = 'medium';
    const rank = { high: 3, medium: 2, low: 1, none: 0 };
    if (rank[confidence] > rank[best.confidence] || (rank[confidence] === rank[best.confidence] && sim > best.similarity)) {
      best = { confidence, item, similarity: sim };
    }
  }
  return best;
}
