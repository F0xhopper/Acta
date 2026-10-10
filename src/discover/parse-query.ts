import { loadCategories, type Category } from '../config.js';
import { slugify } from '../util/slug.js';
import { homeMarket, loadMarkets, marketFor, type Market } from './areas.js';

export interface ParsedQuery {
  raw: string;
  categoryRaw: string;
  categoryKey: string;
  category: Category | undefined;
  area: string;
  market: Market | undefined;   // the configured market the area is in; undefined for anywhere else
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

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "plumbers in Erdington"        -> category "plumbers", area "Erdington", market Birmingham.
 * "cafes near Moseley"           -> category "cafes", area "Moseley".
 * "barbers"                      -> category "barbers", area: the home market (the first active one in config/areas.yaml).
 * "cafes in Didsbury, Manchester" -> area "Didsbury, Manchester", no configured market: searched as written, no postcode filter.
 */
export function parseQuery(raw: string, categories: Category[] = loadCategories(), markets: Market[] = loadMarkets()): ParsedQuery {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('Query is empty');
  const home = homeMarket(markets);
  const names = [...markets.map((m) => esc(m.name)), ...(markets.some((m) => m.key === 'birmingham') ? ['brum'] : [])];
  const m = cleaned.match(/^(.*?)\s+(?:in|near|around)\s+(.+)$/i);
  const trailingCity = new RegExp(`[\\s,]+(${names.join('|')})$`, 'i');
  const categoryRaw = (m ? m[1] : cleaned).trim().replace(trailingCity, '').trim() || (m ? m[1] : cleaned).trim();
  const named = !m ? (cleaned.match(trailingCity)?.[1] ?? null) : null;
  const area = (m ? m[2] : named ?? home?.name ?? 'UK').trim().replace(/,?\s*(uk|england|scotland|wales|united kingdom)$/i, '').trim();
  // "Moseley, Birmingham" -> Moseley in the Birmingham market; "Moseley" -> looked up in the neighbourhood lists.
  const suffixed = markets.find((mk) => new RegExp(`,?\\s*${esc(mk.name)}$`, 'i').test(area) && area.toLowerCase() !== mk.name.toLowerCase());
  const areaLabel = suffixed ? area.replace(new RegExp(`,?\\s*${esc(suffixed.name)}$`, 'i'), '').trim() : area;
  const market = suffixed ?? marketFor(areaLabel, markets);
  const category = resolveCategory(categoryRaw, categories);
  const categoryKey = category?.key ?? slugify(categoryRaw);
  const label = market && areaLabel.toLowerCase() === market.name.toLowerCase() ? market.name : areaLabel;
  const textQuery = !market ? `${categoryRaw} in ${label}, UK`
    : label === market.name ? `${categoryRaw} in ${market.name}, UK`
    : `${categoryRaw} in ${label}, ${market.name}, UK`;
  return { raw: cleaned, categoryRaw, categoryKey, category, area: label, market, textQuery };
}
