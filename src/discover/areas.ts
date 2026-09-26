import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

const AreasFile = z.object({ groups: z.record(z.string(), z.array(z.string())) });

export function loadAreaGroups(): Record<string, string[]> {
  return AreasFile.parse(parseYaml(readFileSync(join(ROOT, 'config', 'areas.yaml'), 'utf8'))).groups;
}

/**
 * "plumbers" + "trades" -> ["plumbers in Erdington", "plumbers in Kingstanding", ...].
 * Any area already in the query is dropped. `spec` is a group name or a comma-separated list of areas.
 */
export function expandAreas(query: string, spec: string, groups: Record<string, string[]> = loadAreaGroups()): string[] {
  const trade = query.replace(/\s+(in|near|around)\s+.+$/i, '').trim();
  const areas = groups[spec] ?? spec.split(',').map((a) => a.trim()).filter(Boolean);
  if (!areas.length) throw new Error(`No areas for "${spec}". Groups: ${Object.keys(groups).join(', ')}`);
  return [...new Set(areas)].map((a) => `${trade} in ${a}`);
}
