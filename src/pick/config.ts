import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

export const PickSchema = z.object({
  filters: z.object({
    tiers: z.array(z.string()).default(['A']),
    min_reviews: z.number().default(20),
    max_review_age_days: z.number().default(365),
    min_photos: z.number().default(3),
    allow_unknown_photos: z.boolean().default(true),
    audit_fresh_days: z.number().default(30),
    require_contact: z.boolean().default(true),
  }).prefault({}),
  score: z.object({ lead_weight: z.number().default(0.6), buildability_weight: z.number().default(0.4), ltd_bonus: z.number().default(5) }).prefault({}),
  diversity: z.object({ max_per_week: z.number().default(10), max_per_trade_area: z.number().default(2), max_walk_in_per_area: z.number().default(1) }).prefault({}),
  buildability: z.object({
    photos_8: z.number().default(40), photos_3: z.number().default(25), photos_1: z.number().default(10),
    has_live_site: z.number().default(15), has_description: z.number().default(15), reviews_with_text_3: z.number().default(20), hours_listed: z.number().default(10),
  }).prefault({}),
});
export type PickConfig = z.infer<typeof PickSchema>;
export function loadPick(): PickConfig {
  return PickSchema.parse(parseYaml(readFileSync(join(ROOT, 'config', 'pick.yaml'), 'utf8')));
}
