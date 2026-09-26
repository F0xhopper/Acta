import { loadCategories, type Category } from '../config.js';
import { slugify } from '../util/slug.js';

export interface ParsedQuery {
  raw: string;
  categoryRaw: string;
  categoryKey: string;
  category: Category | undefined;
  area: string;
  textQuery: string;
}

/** Resolve free-text category words to a configured category by longest keyword match. */
export function resolveCategory(words: string, categories: Category[] = loadCategories()): Category | undefined {
  const w = ` ${words.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let best: { cat: Category; len: number } | undefined;
  for (const cat of categories) {
    for (const kw of cat.keywords) {
      const k = ` ${kw.toLowerCase()} `;
      if (w.includes(k) && (!best || k.length > best.len)) best = { cat, len: k.length };
    }
  }
  return best?.cat;
}

/**
 * "plumbers in Erdington" -> category "plumbers", area "Erdington".
 * "cafes near Moseley"    -> category "cafes", area "Moseley".
 * "barbers"               -> category "barbers", area "Birmingham".
 */
export function parseQuery(raw: string, categories: Category[] = loadCategories()): ParsedQuery {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('Query is empty');
  const m = cleaned.match(/^(.*?)\s+(?:in|near|around)\s+(.+)$/i);
  const categoryRaw = (m ? m[1] : cleaned).trim().replace(/[\s,]+(birmingham|brum)$/i, '').trim() || (m ? m[1] : cleaned).trim();
  let area = (m ? m[2] : 'Birmingham').trim().replace(/,?\s*(uk|england|united kingdom)$/i, '').trim();
  const mentionsBirmingham = /birmingham/i.test(area);
  const areaLabel = area.replace(/,?\s*birmingham$/i, '').trim() || 'Birmingham';
  const category = resolveCategory(categoryRaw, categories);
  const categoryKey = category?.key ?? slugify(categoryRaw);
  const textQuery = mentionsBirmingham && areaLabel === 'Birmingham'
    ? `${categoryRaw} in Birmingham, UK`
    : `${categoryRaw} in ${areaLabel}, Birmingham, UK`;
  return { raw: cleaned, categoryRaw, categoryKey, category, area: areaLabel, textQuery };
}
