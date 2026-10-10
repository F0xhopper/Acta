/**
 * What there is to build a site from, before anything is built: photos, a logo, words about the business, services
 * and prices, reviews to quote, hours, contact details and social links, each with where it would come from. The
 * less there is, the more the site has to make up (stock photos, a typical services list, a designed wordmark),
 * and the weaker the preview looks next to the real business. Pure: everything comes from the listing and the audit.
 */
import type { Category } from '../config.js';
import type { FullLead } from '../db/types.js';
import { reachOf } from './reach.js';

export type Have = 'yes' | 'some' | 'no';
export type ContentKey = 'photos' | 'logo' | 'about' | 'services' | 'reviews' | 'hours' | 'contact' | 'social';
export interface ContentItem { key: ContentKey; label: string; have: Have; detail: string; points: number; max: number }
export type ContentLevel = 'plenty' | 'some' | 'little';
export interface Content { score: number; level: ContentLevel; label: string; items: ContentItem[]; makeUp: string[] }

/** Points per item, out of 100. */
export const CONTENT_WEIGHTS: Record<ContentKey, number> = { photos: 30, about: 15, services: 15, reviews: 15, logo: 10, hours: 5, contact: 5, social: 5 };
export const CONTENT_LEVEL_LABEL: Record<ContentLevel, string> = { plenty: 'Plenty to build from', some: 'Some gaps to fill', little: 'Mostly made up' };

const PLATFORM_NAMES: [RegExp, string][] = [
  [/fresha/, 'Fresha'], [/booksy/, 'Booksy'], [/treatwell/, 'Treatwell'], [/just-?eat/, 'Just Eat'], [/deliveroo/, 'Deliveroo'], [/ubereats/, 'Uber Eats'],
  [/foodhub/, 'Foodhub'], [/square/, 'Square'], [/setmore/, 'Setmore'], [/calendly/, 'Calendly'], [/vagaro/, 'Vagaro'], [/flipdish/, 'Flipdish'], [/bookwhen/, 'Bookwhen'],
];
const platformName = (host: string | null) => PLATFORM_NAMES.find(([re]) => host && re.test(host))?.[1] ?? 'their booking page';
const SOCIAL_NAME: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', youtube: 'YouTube' };

export function contentOf(full: FullLead, category: Category | undefined): Content {
  const { lead, audit } = full;
  const status = audit?.website_status ?? 'none';
  const found = !!lead.found_site_url && status !== 'live';   // their own site, found by name, not linked on Google
  const live = status === 'live' || found;
  // A dead site's last archived copy (the Wayback Machine, src/audit/rescue.ts): real words, photos and a logo, a little stale.
  const archived = !live && !!audit?.wayback_url;
  const archivedWhen = audit?.wayback_at ? new Date(audit.wayback_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null;
  const archiveWord = `their old site (archived copy${archivedWhen ? ` from ${archivedWhen}` : ''})`;
  const ARCHIVE = 0.8;
  const siteWord = found ? 'their website (not on Google)' : 'their website';
  const platform = status === 'platform_only';
  const host = audit?.final_domain ?? (lead.website_url ? (() => { try { return new URL(lead.website_url!).hostname; } catch { return null; } })() : null);
  const socials = reachOf(full, category).socials;
  const socialNames = [...new Set(socials.map((s) => SOCIAL_NAME[s.kind] ?? s.kind))];
  const photoSocial = socialNames.filter((n) => n === 'Instagram' || n === 'Facebook' || n === 'TikTok');
  let reviews: { text?: string }[] = [];
  try { reviews = JSON.parse(lead.reviews_json ?? '[]'); } catch { /* none */ }
  const withText = reviews.filter((r) => (r.text ?? '').length >= 40).length;
  const W = CONTENT_WEIGHTS;
  const items: ContentItem[] = [];
  const item = (key: ContentKey, label: string, have: Have, detail: string, frac: number) => items.push({ key, label, have, detail, points: Math.round(W[key] * frac), max: W[key] });

  // Photos: Google gives up to 10 with the listing; their site and a booking page add more; social feeds need their say-so.
  const g = lead.photo_count;
  const extra = [live ? siteWord : null, archived ? archiveWord : null, platform ? platformName(host) : null].filter(Boolean) as string[];
  const gFrac = g === null ? 0 : g >= 8 ? 0.8 : g >= 3 ? 0.55 : g >= 1 ? 0.25 : 0;
  const pFrac = Math.min(1, gFrac + (extra.length ? 0.3 : 0) + (photoSocial.length ? 0.15 : 0));
  const pSources = [g === null ? 'Google photos not counted yet' : g ? `${g >= 10 ? '10+' : g} on Google` : 'none on Google', ...extra, ...photoSocial.map((s) => `${s} (ask to use)`)];
  item('photos', 'Photos', pFrac >= 0.75 ? 'yes' : pFrac >= 0.3 ? 'some' : 'no', pSources.join(' · '), pFrac);

  if (live) item('logo', 'Logo and colours', 'yes', `From ${siteWord}`, 1);
  else if (archived) item('logo', 'Logo and colours', 'yes', `From ${archiveWord}`, ARCHIVE);
  else if (photoSocial.length || platform) item('logo', 'Logo and colours', 'some', `Profile picture on ${photoSocial[0] ?? platformName(host)}, probably low resolution`, 0.5);
  else item('logo', 'Logo and colours', 'no', 'Nothing to take from: a wordmark would be designed', 0);

  if (lead.editorial_summary) item('about', 'About the business', 'yes', "Google's summary", 1);
  else if (audit?.site_description && archived) item('about', 'About the business', 'yes', archiveWord.replace(/^t/, 'T'), ARCHIVE);
  else if (audit?.site_description) item('about', 'About the business', 'yes', 'Their website', 1);
  else if (withText >= 3) item('about', 'About the business', 'some', 'Written from what customers say in reviews', 0.5);
  else item('about', 'About the business', 'no', 'Would be written from the trade and area alone', 0.1);

  if (live) item('services', 'Services and prices', 'yes', siteWord.replace(/^t/, 'T'), 1);
  else if (archived) item('services', 'Services and prices', 'yes', `${archiveWord.replace(/^t/, 'T')}, prices to check with them`, ARCHIVE);
  else if (platform) item('services', 'Services and prices', 'yes', `Price list on ${platformName(host)}`, 1);
  else item('services', 'Services and prices', 'no', `A typical ${category ? category.key.replace(/_/g, ' ') : 'business'} list, prices to ask them for`, 0);

  if (withText >= 3) item('reviews', 'Reviews to quote', 'yes', `${withText} with text, ${lead.review_count ?? 0} in all`, 1);
  else if (withText >= 1) item('reviews', 'Reviews to quote', 'some', `${withText} with text`, 0.5);
  else item('reviews', 'Reviews to quote', 'no', (lead.review_count ?? 0) ? `${lead.review_count} star ratings, no text to quote` : 'No reviews', 0);

  item('hours', 'Opening hours', lead.opening_hours_json ? 'yes' : 'no', lead.opening_hours_json ? 'On Google' : 'Not listed: ask them', lead.opening_hours_json ? 1 : 0);
  const contactBits = [lead.phone_e164 ? 'phone' : null, lead.address ? 'address and map' : null].filter(Boolean) as string[];
  item('contact', 'Contact and map', contactBits.length === 2 ? 'yes' : contactBits.length ? 'some' : 'no', contactBits.length ? `On Google: ${contactBits.join(', ')}` : 'Nothing listed', contactBits.length / 2);
  item('social', 'Social links', socialNames.length ? 'yes' : 'no', socialNames.length ? socialNames.join(', ') : 'None found', socialNames.length ? 1 : 0);

  const score = Math.min(100, items.reduce((a, i) => a + i.points, 0));
  const level: ContentLevel = score >= 70 ? 'plenty' : score >= 45 ? 'some' : 'little';
  const gap: Partial<Record<ContentKey, Record<'some' | 'no', string>>> = {
    photos: { some: 'Photos: a few real ones, the rest stock or generated', no: 'Photos: none to use, stock or generated throughout' },
    logo: { some: 'Logo: only a small profile picture to redraw', no: 'Logo: none, a wordmark would be designed' },
    about: { some: 'About text: written from their reviews', no: 'About text: written from the trade and area alone' },
    services: { some: 'Services: partly known', no: `Services and prices: a typical list, prices to ask them for` },
    reviews: { some: 'Reviews: one or two to quote', no: 'Reviews: nothing to quote' },
  };
  const makeUp = items.filter((i) => i.have !== 'yes' && gap[i.key]).map((i) => gap[i.key]![i.have as 'some' | 'no']);
  return { score, level, label: CONTENT_LEVEL_LABEL[level], items, makeUp };
}
