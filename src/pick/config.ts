import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

/** Routes to get the preview to them: cold_email (a limited company with an email), email (any email, after a call), mobile, social, landline, visit. */
export const Route = z.enum(['cold_email', 'email', 'mobile', 'social', 'landline', 'visit']);
export type Route = z.infer<typeof Route>;

export const PickSchema = z.object({
  gates: z.object({
    min_trade_value: z.number().default(50),
    min_opportunity: z.number().default(50),
    weak_site_trade_value: z.number().default(70),   // the buyer lane: a live site that shows its age passes the gap gate in a trade worth this much
    min_reviews: z.number().default(15),
    min_rating: z.number().default(4.0),
    max_review_age_days: z.number().default(365),
    recency_reviews_under: z.number().default(30),   // the review-date part of "established" only applies under this many reviews
    reach: z.array(Route).default(['cold_email', 'email', 'mobile', 'social']),
    min_content: z.number().default(55),
  }).prefault({}),
  grade: z.object({
    gap: z.number().default(20), trade: z.number().default(20), reputation: z.number().default(15),
    reach: z.number().default(15), content: z.number().default(15), means: z.number().default(10),
  }).prefault({}),
  trade: z.object({
    learn_weight: z.number().min(1).default(10),
    sweep_full_at: z.number().min(1).max(100).default(75),
  }).prefault({}),
  auto: z.object({ audit_fresh_days: z.number().default(30) }).prefault({}),
  web_email: z.object({ ltd_only: z.boolean().default(true), min_trade_value: z.number().default(60) }).prefault({}),
  suggest: z.object({
    near_misses: z.number().default(12),
    new_days: z.number().default(7),
    limit: z.number().default(12),
    repeat_decay: z.number().min(0).max(1).default(0.85),
  }).prefault({}),
  diversity: z.object({ max_per_week: z.number().default(10), max_per_trade_area: z.number().default(2), max_walk_in_per_area: z.number().default(1) }).prefault({}),
});
export type PickConfig = z.infer<typeof PickSchema>;
export function loadPick(): PickConfig {
  return PickSchema.parse(parseYaml(readFileSync(join(ROOT, 'config', 'pick.yaml'), 'utf8')));
}
