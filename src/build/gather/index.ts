import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { DATA_DIR, env, findCategory } from '../../config.js';
import { fullLeads, getCompaniesHouse } from '../../db/queries.js';
import type { FullLead } from '../../db/types.js';
import { getCompanyProfile } from '../../discover/companies-house.js';
import { describeLead, reviewsOf } from '../../report/describe.js';
import { displayUkPhone } from '../../util/phone.js';
import { BrandSchema, FactsSchema, SITE_PATHS, type Brand, type Facts } from '../contracts.js';
import { colourWord, dominantColours, toHex, voteColours, type Hex } from './colours.js';
import { crawlSite } from './crawl.js';
import { looksLikeGoogleBadge, saveLogo, savePhoto } from './download.js';
import { claimsFromReviews, extractAreas, extractClaims, extractServices, toneHints } from './facts.js';
import { extractFonts } from './fonts.js';
import { rankLogoCandidates } from './logo.js';
import { selectSitePhotos } from './photos.js';
import { downloadPlacePhoto, placeDetails, type PlaceDetails } from './places.js';
import type { PageData } from './types.js';

export interface GatherOpts { force?: boolean; onRequest?: (api: 'places' | 'ch') => void; log?: (msg: string) => void }
export interface GatherResult { brand: Brand; facts: Facts; full: FullLead; dir: string; files: { brand: string; facts: string; logo: string | null; photos: string[] } }

export const brandDir = (slug: string) => join(DATA_DIR, 'brand', slug);
const CACHE_DAYS = 30;

/** Everything the extraction needs, with the network parts already done. Lets tests inject pages and photos. */
export interface GatherInputs {
  full: FullLead;
  pages: PageData[];
  details: PlaceDetails | null;
  logo: Brand['logo'];
  logoColours: Hex[];
  photos: Brand['photos'];
  photoColours: Hex[];
  competitors: Facts['competitors'];
  company: Facts['company'];
  notes: string[];
}

const socialOf = (links: string[]): Brand['social'] => {
  const s: Brand['social'] = {};
  for (const l of links) {
    if (/instagram\.com/i.test(l) && !s.instagram) s.instagram = l;
    else if (/facebook\.com|fb\.com/i.test(l) && !s.facebook) s.facebook = l;
    else if (/tiktok\.com/i.test(l) && !s.tiktok) s.tiktok = l;
    else if (/twitter\.com|x\.com/i.test(l) && !s.x) s.x = l;
    else if (/linkedin\.com/i.test(l) && !s.linkedin) s.linkedin = l;
    else if (/youtube\.com/i.test(l) && !s.youtube) s.youtube = l;
  }
  return s;
};

const label = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Pure assembly: brand.json from gathered inputs. */
export function buildBrand(i: GatherInputs): Brand {
  const { full, pages } = i;
  const home = pages[0];
  const st = home?.styles;
  const cssVars: Record<string, Hex> = {};
  for (const [k, v] of Object.entries(home?.cssVars ?? {})) { const h = toHex(v); if (h) cssVars[k] = h; }
  const palette = voteColours({
    headerBg: toHex(st?.header.bg), buttonBg: toHex(st?.button.bg), buttonText: toHex(st?.button.color), navLink: toHex(st?.navLink.color),
    h1: toHex(st?.h1.color), bodyText: toHex(st?.body.color), bodyBg: toHex(st?.body.bg), cssVars, logo: i.logoColours, photos: i.photoColours,
  });
  const reviews = reviewsOf(full);
  const audit = full.audit;
  const keep: string[] = [];
  const drop: string[] = [];
  if (audit?.phone_matches_listing) keep.push(`customers know the phone number ${displayUkPhone(full.lead.phone_e164)}`);
  if (palette.confidence === 'high' && palette.primary) keep.push(`current primary colour ${palette.primary} (${colourWord(palette.primary)})`);
  if (audit?.title) keep.push(`current page title: "${audit.title}"`);
  if (audit?.has_viewport === 0) drop.push('no mobile viewport');
  if (audit?.copyright_year && new Date().getFullYear() - audit.copyright_year >= 3) drop.push(`copyright ${audit.copyright_year}`);
  if (audit?.free_tier_host) drop.push('free-tier host');
  if (audit?.lh_perf !== null && audit?.lh_perf !== undefined && audit.lh_perf < 50) drop.push(`slow on mobile (Lighthouse ${audit.lh_perf})`);
  if (audit?.https_ok === 0) drop.push('no HTTPS');
  const upsells: string[] = [];
  if (i.logo.quality === 'raster_low' || i.logo.quality === 'none') upsells.push('Redraw the logo as a clean vector');
  if (i.photos.length < 3) upsells.push('Replace stock images with your own photos');
  if (!pages.some((p) => p.emails.length)) upsells.push('Set up a proper @domain email address');
  if ((full.lead.review_count ?? 0) < 10) upsells.push('Claim and tidy the Google Business Profile');
  return BrandSchema.parse({
    name: full.lead.name,
    slug: full.lead.slug,
    gathered_at: new Date().toISOString(),
    logo: i.logo,
    palette,
    fonts: extractFonts(pages),
    photos: i.photos,
    social: socialOf(pages.flatMap((p) => p.socialLinks)),
    tone_hints: toneHints(reviews),
    existing_site: { url: audit?.final_url ?? full.lead.website_url ?? null, status: audit?.website_status ?? 'unaudited', keep, drop },
    quality: { logo: i.logo.quality, photo_count: i.photos.length, colour_confidence: palette.confidence, upsells },
  });
}

/** Pure assembly: facts.json from gathered inputs. */
export function buildFacts(i: GatherInputs): Facts {
  const { full, pages, details } = i;
  const lead = full.lead;
  const reviews = reviewsOf(full);
  const category = findCategory(lead.category_key);
  const text = pages.map((p) => p.text).join(' \n ');
  const claims = [
    ...pages.flatMap((p) => extractClaims(p.text, p.url)),
    ...(i.company?.incorporated ? [{ claim: `Limited company since ${i.company.incorporated.slice(0, 4)}`, source: 'companies_house' as const, quote: `Incorporated ${i.company.incorporated}` }] : []),
    ...claimsFromReviews(reviews),
  ];
  const dedup = new Map<string, (typeof claims)[number]>();
  for (const c of claims) if (!dedup.has(c.claim)) dedup.set(c.claim, c);
  const email = pages.flatMap((p) => p.emails)[0] ?? null;
  const hours: string[] = lead.opening_hours_json ? JSON.parse(lead.opening_hours_json) : [];
  const attributes: Facts['attributes'] = {};
  if (details?.accessibilityOptions?.wheelchairAccessibleEntrance !== undefined) attributes.wheelchair = details.accessibilityOptions.wheelchairAccessibleEntrance;
  if (details?.parkingOptions && Object.keys(details.parkingOptions).length) attributes.parking = Object.values(details.parkingOptions).some(Boolean);
  if (details?.paymentOptions) attributes.card_payments = !!(details.paymentOptions.acceptsCreditCards || details.paymentOptions.acceptsDebitCards || details.paymentOptions.acceptsNfc);
  if (details?.goodForChildren !== undefined) attributes.kids = details.goodForChildren;
  if (details?.allowsDogs !== undefined) attributes.dogs = details.allowsDogs;
  return FactsSchema.parse({
    gathered_at: new Date().toISOString(),
    business: {
      name: lead.name,
      phone_e164: lead.phone_e164,
      phone_display: lead.phone_e164 ? displayUkPhone(lead.phone_e164) : null,
      whatsapp: lead.phone_e164?.startsWith('+447') ? `https://wa.me/${lead.phone_e164.slice(1)}` : null,
      email,
      address: lead.address,
      postcode: lead.postcode,
      area: lead.area,
      city: 'Birmingham',
      maps_url: lead.google_maps_url,
      hours,
      rating: lead.rating,
      review_count: lead.review_count,
      category_key: lead.category_key,
      category_label: label(lead.category_key),
      type_label: lead.type_label,
      description: details?.editorialSummary?.text ?? describeLead(full).text,
    },
    company: i.company,
    services: extractServices(pages, lead.category_key),
    areas: extractAreas(text, lead.area),
    claims: [...dedup.values()],
    reviews,
    attributes,
    must_haves: category?.must_haves ?? [],
    competitors: i.competitors,
  });
}

export function pickCompetitors(full: FullLead): Facts['competitors'] {
  const all = fullLeads({ minViability: 60 }).filter((r) =>
    r.lead.id !== full.lead.id && r.lead.category_key === full.lead.category_key && !r.lead.is_chain && r.audit?.website_status === 'live' && r.audit.final_url && r.audit.lh_perf !== null);
  let good = all.filter((r) => (r.audit!.lh_perf ?? 0) >= 80);
  if (good.length < 3) good = all.filter((r) => (r.audit!.lh_perf ?? 0) >= 60);
  return good.sort((a, b) => (b.audit!.lh_perf ?? 0) - (a.audit!.lh_perf ?? 0)).slice(0, 5)
    .map((r) => ({ name: r.lead.name, url: r.audit!.final_url!, screenshot: r.audit!.screenshot_mobile ?? null, notes: null }));
}

async function companyOf(full: FullLead, onRequest?: (api: 'places' | 'ch') => void): Promise<Facts['company']> {
  const ch = getCompaniesHouse(full.lead.id);
  if (!ch || ch.match_confidence !== 'high' || !ch.company_number) return null;
  let incorporated: string | null = null;
  let status = ch.company_status ?? null;
  try {
    const p = await getCompanyProfile(ch.company_number, () => onRequest?.('ch')) as { date_of_creation?: string; company_status?: string };
    incorporated = p.date_of_creation ?? null;
    status = p.company_status ?? status;
  } catch { /* keep what we have */ }
  return { number: ch.company_number, name: ch.company_name ?? full.lead.name, incorporated, status };
}

/** Gather everything findable about a lead into data/brand/<slug>/. Cached for 30 days. */
export async function gather(full: FullLead, opts: GatherOpts = {}): Promise<GatherResult> {
  const log = opts.log ?? (() => undefined);
  const dir = brandDir(full.lead.slug);
  const files = { brand: join(dir, 'brand.json'), facts: join(dir, 'facts.json'), logo: null as string | null, photos: [] as string[] };
  if (!opts.force && existsSync(files.brand) && existsSync(files.facts)) {
    try {
      const brand = BrandSchema.parse(JSON.parse(readFileSync(files.brand, 'utf8')));
      if ((Date.now() - new Date(brand.gathered_at).getTime()) / 86_400_000 < CACHE_DAYS) {
        const facts = FactsSchema.parse(JSON.parse(readFileSync(files.facts, 'utf8')));
        log(`gather: using cached brand for ${full.lead.slug} from ${brand.gathered_at.slice(0, 10)}`);
        return { brand, facts, full, dir, files: { ...files, logo: brand.logo.path, photos: brand.photos.map((p) => p.path) } };
      }
    } catch { /* regather */ }
  }
  mkdirSync(join(dir, 'photos'), { recursive: true });
  mkdirSync(join(dir, 'pages'), { recursive: true });
  const notes: string[] = [];

  // 1. Google: details and photos.
  let details: PlaceDetails | null = null;
  const photos: Brand['photos'] = [];
  const key = process.env.GOOGLE_PLACES_API_KEY ?? '';
  if (key) {
    try {
      details = await placeDetails(full.lead.place_id, key, () => opts.onRequest?.('places'));
      let n = 0;
      for (const ph of (details.photos ?? []).slice(0, 10)) {
        const dest = join(dir, 'photos', `google-${++n}.jpg`);
        try {
          const got = await downloadPlacePhoto(ph, key, dest, () => opts.onRequest?.('places'));
          if (got) photos.push({ path: got.path, source: 'google', width: got.width, height: got.height, attribution: got.attribution, alt: null, page_url: null });
        } catch (e) { notes.push(`google photo ${n} failed: ${(e as Error).message.slice(0, 80)}`); }
      }
      log(`gather: ${photos.length} Google photos`);
    } catch (e) {
      notes.push(`place details failed: ${(e as Error).message.slice(0, 120)}`);
      log(`gather: place details failed (${(e as Error).message.slice(0, 80)})`);
    }
  } else {
    notes.push('no GOOGLE_PLACES_API_KEY, skipped Place Details');
  }

  // 2. Their site.
  let pages: PageData[] = [];
  const siteUrl = full.audit?.website_status === 'live' ? full.audit.final_url : null;
  if (siteUrl) {
    pages = await crawlSite(siteUrl, { log });
    pages.forEach((p, i) => writeFileSync(join(dir, 'pages', `${i}.json`), JSON.stringify({ ...p, html: undefined }, null, 2)));
    pages.forEach((p, i) => writeFileSync(join(dir, 'pages', `${i}.html`), p.html));
    log(`gather: crawled ${pages.length} pages`);
  }

  // 3. Logo.
  let logo: Brand['logo'] = { path: null, format: null, width: null, height: null, quality: 'none', source: 'none', source_url: null };
  let logoColours: Hex[] = [];
  const ranking = rankLogoCandidates(pages);
  // Save up to five accepted candidates so the designer can check them by eye, then pick the best by ranking and size.
  const candDir = join(dir, 'logo-candidates');
  rmSync(candDir, { recursive: true, force: true });
  mkdirSync(candDir, { recursive: true });
  const accepted: { cand: (typeof ranking.candidates)[number]; saved: NonNullable<Awaited<ReturnType<typeof saveLogo>>> }[] = [];
  for (const cand of ranking.candidates) {
    if (accepted.length >= 5) break;
    const saved = await saveLogo(cand.url, join(candDir, String(accepted.length + 1)), { allowLarge: cand.source !== 'og_image' });
    if (!saved) continue;
    if (saved.format === 'png' && await looksLikeGoogleBadge(readFileSync(saved.path))) {
      ranking.rejected.push({ url: cand.url, why: 'looks like a Google review badge' });
      log(`gather: rejected ${cand.source} candidate, it looks like a Google review badge`);
      try { rmSync(saved.path); } catch { /* ignore */ }
      continue;
    }
    accepted.push({ cand, saved });
  }
  writeFileSync(join(candDir, 'candidates.json'), JSON.stringify(accepted.map((a, i) => ({ file: basename(a.saved.path), rank: i + 1, source: a.cand.source, why: a.cand.why, url: a.cand.url, width: a.saved.width, height: a.saved.height, quality: a.saved.quality })), null, 2));
  const pick = accepted.find((a) => a.saved.quality === 'svg' || a.saved.quality === 'raster_ok') ?? accepted[0];
  if (pick) {
    const dest = join(dir, `logo.${pick.saved.format}`);
    copyFileSync(pick.saved.path, dest);
    logo = { path: dest, format: pick.saved.format, width: pick.saved.width, height: pick.saved.height, quality: pick.saved.quality, source: pick.cand.source, source_url: pick.cand.url };
    files.logo = dest;
    if (pick.saved.format === 'png') {
      try { logoColours = (await dominantColours(readFileSync(dest))).map((c) => c.hex); } catch { /* none */ }
    } else {
      const svg = readFileSync(dest, 'utf8');
      logoColours = [...new Set([...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))].filter((h) => !/^#f{6}$|^#0{6}$/i.test(h)).slice(0, 5);
    }
    log(`gather: logo from ${pick.cand.source} (${pick.saved.quality}), ${accepted.length} candidates saved for the designer to check`);
  }
  if (ranking.rejected.length) notes.push(`rejected logo candidates: ${ranking.rejected.map((r) => r.url.split('/').pop()).join(', ')}`);

  // 4. Their photos.
  const picks = selectSitePhotos(pages, ranking.candidates.map((c) => c.url));
  let sn = 0;
  const seenDims = new Set(photos.map((p) => `${p.width}x${p.height}`));
  for (const pick of picks) {
    const dest = join(dir, 'photos', `site-${++sn}.jpg`);
    const got = await savePhoto(pick.src, dest);
    if (!got) { sn--; continue; }
    if (seenDims.has(`${got.width}x${got.height}`)) { sn--; continue; }
    seenDims.add(`${got.width}x${got.height}`);
    photos.push({ path: dest, source: 'site', width: got.width, height: got.height, attribution: null, alt: pick.alt, page_url: pick.pageUrl });
  }
  files.photos = photos.map((p) => p.path);
  const photoColours: Hex[] = [];
  for (const p of photos.slice(0, 3)) {
    try { photoColours.push(...(await dominantColours(readFileSync(p.path), 2)).map((c) => c.hex)); } catch { /* skip */ }
  }

  const inputs: GatherInputs = { full, pages, details, logo, logoColours, photos, photoColours, competitors: pickCompetitors(full), company: await companyOf(full, opts.onRequest), notes };
  const brand = buildBrand(inputs);
  const facts = buildFacts(inputs);
  writeFileSync(files.brand, JSON.stringify(brand, null, 2));
  writeFileSync(files.facts, JSON.stringify(facts, null, 2));
  if (notes.length) writeFileSync(join(dir, 'notes.txt'), notes.join('\n'));
  log(`gather: done. logo=${brand.quality.logo} palette=${brand.palette.primary ?? 'none'} (${brand.palette.confidence}) photos=${photos.length} claims=${facts.claims.length}`);
  return { brand, facts, full, dir, files };
}

/** Copy assets into a site repo and write the acta/*.json files with repo-relative paths. */
export function copyIntoRepo(result: GatherResult, repoDir: string): { brandJson: string; factsJson: string } {
  const brandOut = join(repoDir, SITE_PATHS.brandDir);
  const photosOut = join(repoDir, SITE_PATHS.photosDir);
  mkdirSync(photosOut, { recursive: true });
  mkdirSync(join(repoDir, 'acta'), { recursive: true });
  const brand: Brand = JSON.parse(JSON.stringify(result.brand));
  if (brand.logo.path && existsSync(brand.logo.path)) {
    const dest = join(brandOut, `logo.${brand.logo.format ?? 'png'}`);
    copyFileSync(brand.logo.path, dest);
    brand.logo.path = relative(repoDir, dest);
  } else {
    brand.logo.path = null;
  }
  const candSrc = join(result.dir, 'logo-candidates');
  if (existsSync(candSrc)) cpSync(candSrc, join(brandOut, 'logo-candidates'), { recursive: true });
  brand.photos = brand.photos.filter((p) => existsSync(p.path)).map((p) => {
    const dest = join(photosOut, basename(p.path));
    copyFileSync(p.path, dest);
    return { ...p, path: relative(repoDir, dest) };
  });
  brand.quality.photo_count = brand.photos.length;
  const facts: Facts = JSON.parse(JSON.stringify(result.facts));
  facts.competitors = facts.competitors.map((c) => {
    if (c.screenshot && existsSync(c.screenshot)) {
      const dir = join(repoDir, SITE_PATHS.research, 'competitors');
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, basename(c.screenshot));
      copyFileSync(c.screenshot, dest);
      return { ...c, screenshot: relative(repoDir, dest) };
    }
    return { ...c, screenshot: null };
  });
  const brandJson = join(repoDir, SITE_PATHS.brand);
  const factsJson = join(repoDir, SITE_PATHS.facts);
  writeFileSync(brandJson, JSON.stringify(brand, null, 2));
  writeFileSync(factsJson, JSON.stringify(facts, null, 2));
  writeLeadJson(result.full, repoDir);
  return { brandJson, factsJson };
}

/** Write acta/lead.json for a FullLead, without the raw Places payload. */
export function writeLeadJson(full: FullLead, repoDir: string): string {
  const path = join(repoDir, SITE_PATHS.lead);
  mkdirSync(join(repoDir, 'acta'), { recursive: true });
  const { raw_json: _raw, ...lead } = full.lead;
  void _raw;
  writeFileSync(path, JSON.stringify({ ...full, lead }, null, 2));
  return path;
}
