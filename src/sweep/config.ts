import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

export const SweepSchema = z.object({
  budget: z.number().int().positive().default(20),
  pages: z.number().int().min(1).max(3).default(2),
  mode: z.enum(['auto', 'list']).default('auto'),
  trades: z.union([z.literal('all'), z.array(z.string())]).default('all'),
  skip_trades: z.array(z.string()).default([]),
  variants: z.array(z.string()).default([]),
  ranking: z.object({
    prior_strength: z.number().positive().default(15),
    area_prior_strength: z.number().positive().default(40),
    explore: z.number().min(0).default(1),
    rerun_value: z.number().min(0).max(1).default(0.3),
    same_trade_decay: z.number().min(0).max(1).default(0.7),
    same_area_decay: z.number().min(0).max(1).default(0.85),
  }).prefault({}),
  rotation: z.object({
    revisit_days: z.number().default(42),
    keep_yield: z.number().default(3),
    drop_below: z.number().default(1),
    fresh_first: z.boolean().default(true),
  }).prefault({}),
  searches: z.array(z.object({ trade: z.string(), areas: z.string(), variants: z.boolean().default(false) })).default([]),
}).refine((c) => c.mode === 'auto' || c.searches.length > 0, { message: 'list mode needs at least one entry in searches' });
export type SweepConfig = z.infer<typeof SweepSchema>;

export function loadSweep(): SweepConfig {
  return SweepSchema.parse(parseYaml(readFileSync(join(ROOT, 'config', 'sweep.yaml'), 'utf8')));
}
