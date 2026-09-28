import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = join(ROOT, 'data');
export const OUT_DIR = join(ROOT, 'out');
export const CACHE_DIR = join(DATA_DIR, 'cache');
export const SCREENSHOT_DIR = join(DATA_DIR, 'screenshots');
export const DB_PATH = join(DATA_DIR, 'leads.db');

loadEnv({ path: join(ROOT, '.env'), quiet: true });

const CategorySchema = z.object({
  key: z.string(),
  keywords: z.array(z.string()).min(1),
  pays_for_marketing: z.boolean().default(false),
  walk_in: z.boolean().default(false),
  dm: z.boolean().default(false),
  sic: z.array(z.string()).default([]),
  must_haves: z.array(z.string()).default([]),
  search_terms: z.array(z.string()).default([]),
});
export type Category = z.infer<typeof CategorySchema>;

const CategoriesFile = z.object({ categories: z.array(CategorySchema) });

const ScoringSchema = z.object({
  thresholds: z.object({
    min_viability: z.number(),
    tier_min_viability: z.number(),
    tier_a_min_reviews: z.number().default(10),
    adequate_site_opportunity: z.number(),
    audit_fresh_days: z.number(),
    cache_days: z.number(),
  }),
  opportunity: z.object({
    status: z.record(z.string(), z.number()),
    live: z.object({
      no_https: z.number(),
      listing_link_broken: z.number().default(20),
      no_viewport: z.number(),
      free_tier_host: z.number(),
      perf_under_50: z.number(),
      perf_under_30_extra: z.number(),
      copyright_stale_years: z.number(),
      copyright_stale: z.number(),
      cheap_builder: z.number(),
      seo_under_70: z.number(),
      no_title_or_desc: z.number(),
      no_schema: z.number(),
      phone_mismatch: z.number(),
      ttfb_over_ms: z.number(),
      ttfb_slow: z.number(),
    }),
  }),
  viability: z.object({
    reviews: z.array(z.object({ min: z.number(), points: z.number() })),
    rating_4_0: z.number(),
    rating_4_5_extra: z.number(),
    hours_listed: z.number(),
    pays_for_marketing: z.number(),
    ltd_high: z.number(),
    low_rating_penalty: z.number(),
    exclude_rating_under: z.number().default(3),
    exclude_rating_min_reviews: z.number().default(50),
    no_phone_cap: z.number(),
    recent_review_months: z.number().default(12),
    recent_reviews: z.number().default(10),
    stale_review_months: z.number().default(24),
    stale_reviews: z.number().default(-15),
  }),
  total: z.object({ opportunity_weight: z.number(), viability_weight: z.number() }),
  hosts: z.object({
    social: z.array(z.string()),
    directory: z.array(z.string()),
    platform: z.array(z.string()),
    free_tier: z.array(z.string()),
  }),
  cheap_builders: z.array(z.string()),
  builders: z.array(z.object({ key: z.string(), patterns: z.array(z.string()) })),
  parked_phrases: z.array(z.string()),
  chain_denylist: z.array(z.string()),
  chain_exact_names: z.array(z.string()).default([]),
  excluded_types: z.array(z.string()).default([]),
  local_schema_types: z.array(z.string()),
});
export type Scoring = z.infer<typeof ScoringSchema>;

let categoriesCache: Category[] | null = null;
let scoringCache: Scoring | null = null;

export function loadCategories(): Category[] {
  if (!categoriesCache) {
    const raw = parseYaml(readFileSync(join(ROOT, 'config', 'categories.yaml'), 'utf8'));
    categoriesCache = CategoriesFile.parse(raw).categories;
  }
  return categoriesCache;
}

export function loadScoring(): Scoring {
  if (!scoringCache) {
    const raw = parseYaml(readFileSync(join(ROOT, 'config', 'scoring.yaml'), 'utf8'));
    scoringCache = ScoringSchema.parse(raw);
  }
  return scoringCache;
}

export function findCategory(key: string): Category | undefined {
  return loadCategories().find((c) => c.key === key);
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
