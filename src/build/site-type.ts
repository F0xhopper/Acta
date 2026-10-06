import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

const PageSchema = z.object({ route: z.string(), purpose: z.string(), when: z.string().optional() });
export const SiteTypeSchema = z.object({
  categories: z.array(z.string()),
  goal: z.string(), visitor: z.string(),
  pages: z.array(PageSchema),
  home: z.array(z.object({ section: z.string(), intent: z.string() })),
  features: z.array(z.string()),
  imagery: z.string(), tone: z.string(),
  avoid: z.array(z.string()),
  pinterest: z.array(z.string()),
});
export type SiteType = z.infer<typeof SiteTypeSchema>;
const FileSchema = z.object({ types: z.record(z.string(), SiteTypeSchema), default: z.string() });

export function loadSiteTypes() { return FileSchema.parse(parseYaml(readFileSync(join(ROOT, 'config', 'site-types.yaml'), 'utf8'))); }

/**
 * The type for a category, resolved for one business: conditional pages ("when: photos >= 4") kept or dropped,
 * Pinterest phrases filled with the category, palette word and mood.
 */
export function resolveSiteType(categoryKey: string, ctx: { photos: number; categoryLabel: string; paletteWord: string; mood: string }): SiteType & { name: string } {
  const file = loadSiteTypes();
  const name = Object.entries(file.types).find(([, t]) => t.categories.includes(categoryKey))?.[0] ?? file.default;
  const t = file.types[name];
  const keep = (when?: string) => {
    if (!when) return true;
    const m = when.match(/photos\s*>=\s*(\d+)/);
    return m ? ctx.photos >= Number(m[1]) : true;
  };
  const fill = (s: string) => s.replace('{category}', ctx.categoryLabel.toLowerCase()).replace('{palette}', ctx.paletteWord).replace('{mood}', ctx.mood).replace(/\s+/g, ' ').trim();
  return { ...t, name, pages: t.pages.filter((p) => keep(p.when)), pinterest: t.pinterest.map(fill) };
}

/** Routes the gates must find: fixed routes as-is, [slug] routes are covered by the facts gate. */
export const requiredFixedRoutes = (t: SiteType) => t.pages.map((p) => p.route).filter((r) => !r.includes('['));
