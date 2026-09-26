import type { Scoring } from '../config.js';
import { normaliseName } from './slug.js';

/** Chain or franchise by name: substring denylist plus exact-name list. */
export function isChainName(name: string, scoring: Scoring): boolean {
  const n = name.toLowerCase();
  if (scoring.chain_denylist.some((c) => n.includes(c.toLowerCase()))) return true;
  const norm = normaliseName(name);
  return scoring.chain_exact_names.some((c) => normaliseName(c) === norm);
}

/** Google place types that can never be a customer (stations, stops, hotels, schools ...). */
export function excludedType(primaryType: string | null, typesJson: string | null, scoring: Scoring): string | null {
  const set = new Set(scoring.excluded_types);
  if (primaryType && set.has(primaryType)) return primaryType;
  if (typesJson) {
    try {
      for (const t of JSON.parse(typesJson) as string[]) if (set.has(t)) return t;
    } catch { /* ignore */ }
  }
  return null;
}
