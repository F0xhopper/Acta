import { createHash } from 'node:crypto';
import { findCategory } from '../config.js';

/**
 * A DNS label for the preview subdomain and the Vercel project name.
 * Slugs can be 80 characters; a DNS label is at most 63 and should read well: "<area>-<business>" without the
 * category, truncated to 40 with a short hash when truncated so two long names can't collide.
 */
export function previewLabel(slug: string, name: string, area: string, categoryKey: string): string {
  const clean = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const catWords = new Set([categoryKey, ...(findCategory(categoryKey)?.keywords ?? [])].flatMap((k) => k.toLowerCase().split(/[\s_-]+/)));
  const business = clean(name).split('-').filter((w) => w && !catWords.has(w) && !['ltd', 'limited', 'the', 'and', 'co'].includes(w)).join('-') || clean(name);
  let label = `${clean(area)}-${business}`.replace(/-+/g, '-');
  if (label.length > 40) label = `${label.slice(0, 35).replace(/-+$/, '')}-${createHash('sha1').update(slug).digest('hex').slice(0, 4)}`;
  return label.replace(/^-+|-+$/g, '');
}
