import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

const MarketSchema = z.object({
  name: z.string(),
  centre: z.tuple([z.number(), z.number()]),
  radius_km: z.number().positive().default(15),
  postcodes: z.array(z.string()).min(1),
  active: z.boolean().default(false),
  groups: z.record(z.string(), z.array(z.string())).default({}),
});
const AreasFile = z.object({ markets: z.record(z.string(), MarketSchema) });

export type Market = z.infer<typeof MarketSchema> & { key: string };

let cache: Market[] | null = null;
export function loadMarkets(): Market[] {
  if (!cache) {
    const raw = AreasFile.parse(parseYaml(readFileSync(join(ROOT, 'config', 'areas.yaml'), 'utf8')));
    cache = Object.entries(raw.markets).map(([key, m]) => ({ key, ...m }));
  }
  return cache;
}

export const activeMarkets = (markets: Market[] = loadMarkets()) => markets.filter((m) => m.active);

/** The market searches fall back to when a query names no area: the first active one. */
export const homeMarket = (markets: Market[] = loadMarkets()): Market | undefined => activeMarkets(markets)[0] ?? markets[0];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The market an area belongs to: the market itself by name, or the first market (active first) listing it as a neighbourhood. */
export function marketFor(area: string, markets: Market[] = loadMarkets()): Market | undefined {
  const a = norm(area);
  const ordered = [...activeMarkets(markets), ...markets.filter((m) => !m.active)];
  return ordered.find((m) => norm(m.name) === a || norm(m.key) === a)
    ?? ordered.find((m) => Object.values(m.groups).some((g) => g.some((x) => norm(x) === a)));
}

/** Whether an outward code ("B23", "CV8") is inside a market's postcode areas. "B" matches B23, not BA1. */
export function inMarket(outward: string | null, market: Market): boolean {
  if (!outward) return false;
  const letters = outward.toUpperCase().match(/^[A-Z]{1,2}/)?.[0];
  return !!letters && market.postcodes.some((p) => p.toUpperCase() === letters);
}

/** Group name -> areas across the active markets. A group in several markets is their union. */
export function loadAreaGroups(markets: Market[] = loadMarkets()): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of activeMarkets(markets)) for (const [g, areas] of Object.entries(m.groups)) out[g] = [...new Set([...(out[g] ?? []), ...areas])];
  for (const m of markets) out[m.key] = [...new Set(Object.values(m.groups).flat())];
  return out;
}

/**
 * "plumbers" + "trades" -> ["plumbers in Erdington", "plumbers in Kingstanding", ...].
 * Any area already in the query is dropped. `spec` is a group name, a market key (every neighbourhood in it),
 * or a comma-separated list of areas.
 */
export function expandAreas(query: string, spec: string, groups: Record<string, string[]> = loadAreaGroups()): string[] {
  const trade = query.replace(/\s+(in|near|around)\s+.+$/i, '').trim();
  const areas = groups[spec] ?? spec.split(',').map((a) => a.trim()).filter(Boolean);
  if (!areas.length) throw new Error(`No areas for "${spec}". Groups: ${Object.keys(groups).join(', ')}`);
  return [...new Set(areas)].map((a) => `${trade} in ${a}`);
}
