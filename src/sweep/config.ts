import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ROOT } from '../config.js';

export const SweepSchema = z.object({
  budget: z.number().int().positive().default(30),
  pages: z.number().int().min(1).max(3).default(2),
  rotation: z.object({
    revisit_days: z.number().default(42),
    keep_yield: z.number().default(3),
    drop_below: z.number().default(1),
    fresh_first: z.boolean().default(true),
  }).prefault({}),
  searches: z.array(z.object({ trade: z.string(), areas: z.string(), variants: z.boolean().default(false) })).min(1),
});
export type SweepConfig = z.infer<typeof SweepSchema>;

export function loadSweep(): SweepConfig {
  return SweepSchema.parse(parseYaml(readFileSync(join(ROOT, 'config', 'sweep.yaml'), 'utf8')));
}
