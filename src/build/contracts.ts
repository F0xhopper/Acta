/**
 * Contracts between the pipeline, the gather step, the site starter and the gates.
 * The starter carries a verbatim copy at src/kit/contracts.ts. Change both together.
 */
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BrandSchema = z.object({
  name: z.string(),
  slug: z.string(),
  gathered_at: z.string(),
  logo: z.object({
    path: z.string().nullable(),                 // relative to the site repo root, e.g. public/brand/logo.svg
    format: z.enum(['svg', 'png', 'jpg', 'webp']).nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    quality: z.enum(['svg', 'raster_ok', 'raster_low', 'none']),
    source: z.enum(['site_header', 'apple_touch_icon', 'mask_icon', 'og_image', 'favicon', 'social', 'none']),
    source_url: z.string().nullable(),
  }),
  palette: z.object({
    primary: hex.nullable(),
    secondary: hex.nullable(),
    accent: hex.nullable(),
    neutral: hex.nullable(),
    background: hex.nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
    notes: z.array(z.string()),               // where each colour came from
  }),
  fonts: z.object({
    heading: z.string().nullable(),            // family name as seen on their site
    body: z.string().nullable(),
    google: z.array(z.string()),               // Google Fonts families they load, if any
    source: z.enum(['site', 'none']),
  }),
  photos: z.array(z.object({
    path: z.string(),                          // relative to the site repo root
    source: z.enum(['google', 'site']),
    width: z.number(),
    height: z.number(),
    attribution: z.string().nullable(),
    alt: z.string().nullable(),
    page_url: z.string().nullable(),
  })),
  social: z.object({
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    tiktok: z.string().optional(),
    x: z.string().optional(),
    linkedin: z.string().optional(),
    youtube: z.string().optional(),
  }),
  tone_hints: z.array(z.string()),             // words customers and the business itself use
  existing_site: z.object({
    url: z.string().nullable(),
    status: z.string(),                        // audit website_status
    keep: z.array(z.string()),                 // things worth carrying over
    drop: z.array(z.string()),                 // things to leave behind
  }),
  quality: z.object({
    logo: z.enum(['svg', 'raster_ok', 'raster_low', 'none']),
    photo_count: z.number(),
    colour_confidence: z.enum(['high', 'medium', 'low']),
    upsells: z.array(z.string()),              // "redraw the logo", "swap stock for your photos"
  }),
});
export type Brand = z.infer<typeof BrandSchema>;

export const ClaimSchema = z.object({
  claim: z.string(),
  source: z.enum(['website', 'companies_house', 'review', 'listing']),
  url: z.string().nullable().optional(),
  quote: z.string(),
  author: z.string().nullable().optional(),
});

export const FactsSchema = z.object({
  gathered_at: z.string(),
  business: z.object({
    name: z.string(),
    phone_e164: z.string().nullable(),
    phone_display: z.string().nullable(),
    whatsapp: z.string().nullable(),           // wa.me link when the phone is a UK mobile
    email: z.string().nullable(),
    address: z.string().nullable(),
    postcode: z.string().nullable(),
    area: z.string(),
    city: z.string(),
    maps_url: z.string().nullable(),
    place_id: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    hours: z.array(z.string()),
    rating: z.number().nullable(),
    review_count: z.number().nullable(),
    category_key: z.string(),
    category_label: z.string(),
    type_label: z.string().nullable(),
    description: z.string().nullable(),
  }),
  company: z.object({ number: z.string(), name: z.string(), incorporated: z.string().nullable(), status: z.string().nullable() }).nullable(),
  services: z.array(z.object({ name: z.string(), source: z.enum(['site', 'category', 'listing']), evidence: z.string().nullable().optional() })),
  areas: z.array(z.string()),
  claims: z.array(ClaimSchema),
  reviews: z.array(z.object({ rating: z.number().nullable(), text: z.string(), when: z.string().nullable(), at: z.string().nullable(), author: z.string().nullable() })),
  attributes: z.object({
    wheelchair: z.boolean().optional(), parking: z.boolean().optional(), card_payments: z.boolean().optional(), kids: z.boolean().optional(), dogs: z.boolean().optional(),
  }),
  must_haves: z.array(z.string()),
  competitors: z.array(z.object({ name: z.string(), url: z.string(), screenshot: z.string().nullable(), notes: z.string().nullable() })),
});
export type Facts = z.infer<typeof FactsSchema>;

export const GateResultSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  value: z.union([z.string(), z.number()]).nullable().optional(),
  threshold: z.string().nullable().optional(),
  details: z.array(z.string()).optional(),
});
export const GateReportSchema = z.object({
  pass: z.boolean(),
  head_sha: z.string(),
  ran_at: z.string(),
  ci: z.boolean().optional(),
  gates: z.array(GateResultSchema),
});
export type GateReport = z.infer<typeof GateReportSchema>;

/** Where the pipeline puts things inside a site repo. */
export const SITE_PATHS = {
  lead: 'acta/lead.json',
  brand: 'acta/brand.json',
  facts: 'acta/facts.json',
  research: 'acta/research',
  qa: 'acta/qa',
  gate: 'acta/qa/gate.json',
  brief: 'acta/brief.md',
  content: 'acta/content.md',
  buildLog: 'acta/build-log.md',
  reviewNotes: 'acta/review-notes.md',
  brandDir: 'public/brand',
  photosDir: 'public/brand/photos',
  site: 'src/content/site.ts',
} as const;
