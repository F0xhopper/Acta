// Managed by Acta. Do not edit.
// The shape of src/content/site.ts. Every fact and every line of copy on the site lives there.
import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-hyphenated');

export const SiteSchema = z.object({
  business: z.object({
    name: z.string().min(1),
    phone_e164: z.string().regex(/^\+44\d{9,10}$/).nullable(),
    phone_display: z.string().nullable(),
    whatsapp: z.string().nullable(),            // full wa.me URL or null
    email: z.string().email().nullable(),
    address: z.string().nullable(),
    postcode: z.string().nullable(),
    area: z.string(),
    city: z.string(),
    maps_url: z.string().url().nullable(),
    hours: z.array(z.string()),                 // "Monday: 9:00 am – 5:00 pm"
    rating: z.number().min(0).max(5).nullable(),
    review_count: z.number().int().min(0).nullable(),
  }),
  copy: z.object({
    tagline: z.string(),
    hero_heading: z.string(),
    hero_sub: z.string(),
    about_heading: z.string(),
    about_body: z.string(),
    cta_label: z.string(),
    cta_sub: z.string(),
  }),
  services: z.array(z.object({ slug, name: z.string(), summary: z.string(), body: z.string(), evidence: z.string().optional() })).min(1),
  areas: z.array(z.object({ slug, name: z.string(), body: z.string() })),
  reviews: z.array(z.object({ rating: z.number().min(1).max(5), text: z.string(), author: z.string(), when: z.string() })),
  claims: z.array(z.string()),                  // only claim strings copied from acta/facts.json
  social: z.object({
    instagram: z.string().url().optional(),
    facebook: z.string().url().optional(),
    tiktok: z.string().url().optional(),
    x: z.string().url().optional(),
    linkedin: z.string().url().optional(),
    youtube: z.string().url().optional(),
  }),
  logo: z.object({ path: z.string(), alt: z.string() }).nullable(),   // path is public-relative, e.g. /brand/logo.svg
  photos: z.array(z.object({ path: z.string(), alt: z.string() })),
  meta: z.object({ title: z.string().max(70), description: z.string().max(170) }),
});

export type Site = z.infer<typeof SiteSchema>;
