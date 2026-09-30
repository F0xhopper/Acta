import type { PageData, PageIcon, PageImage } from './types.js';
import { looksLikeBadge } from './types.js';

export type LogoSource = 'site_header' | 'apple_touch_icon' | 'mask_icon' | 'og_image' | 'favicon';
export interface LogoCandidate { url: string; source: LogoSource; score: number; why: string }
export interface LogoRanking { candidates: LogoCandidate[]; rejected: { url: string; why: string }[] }

const sizeOf = (icon: PageIcon): number => {
  const m = icon.sizes?.match(/(\d+)x(\d+)/);
  return m ? Math.max(Number(m[1]), Number(m[2])) : 0;
};

/** Rank possible logos. Higher score first. Badges of suppliers and platforms are rejected outright. */
export function rankLogoCandidates(pages: PageData[]): LogoRanking {
  const home = pages[0];
  const candidates: LogoCandidate[] = [];
  const rejected: { url: string; why: string }[] = [];
  if (!home) return { candidates, rejected };
  const seen = new Set<string>();
  const add = (url: string, source: LogoSource, score: number, why: string, fields: (string | null | undefined)[]) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    if (looksLikeBadge(url, ...fields)) { rejected.push({ url, why: 'matches a supplier or platform badge' }); return; }
    candidates.push({ url, source, score, why });
  };

  const headerImgs = home.images.filter((i) => i.inHeader);
  headerImgs.forEach((img: PageImage, idx) => {
    const named = /logo/i.test(`${img.src} ${img.alt ?? ''} ${img.className ?? ''} ${img.title ?? ''}`);
    const sized = img.width === 0 || (img.width >= 60 && img.width <= 800);
    if (!sized) return;
    const fields = [img.alt, img.title, img.className, img.nearText];
    if (named) add(img.src, 'site_header', 100 - idx, 'header image named logo', fields);
    else if (idx === 0) add(img.src, 'site_header', /\.svg(\?|$)/i.test(img.src) ? 80 : 70, 'first image in the header', fields);
    else add(img.src, 'site_header', 40 - idx, 'image in the header', fields);
  });
  // Any image named logo outside the header, e.g. a hero wordmark.
  for (const img of home.images.filter((i) => !i.inHeader && /logo/i.test(`${i.src} ${i.alt ?? ''} ${i.className ?? ''}`))) {
    add(img.src, 'site_header', 60, 'image named logo', [img.alt, img.title, img.className, img.nearText]);
  }
  const touch = home.icons.filter((i) => /apple-touch-icon/i.test(i.rel)).sort((a, b) => sizeOf(b) - sizeOf(a));
  if (touch[0]) add(touch[0].href, 'apple_touch_icon', 55, 'apple touch icon', []);
  const mask = home.icons.find((i) => /mask-icon/i.test(i.rel));
  if (mask) add(mask.href, 'mask_icon', 50, 'mask icon (svg)', []);
  if (home.ogImage) {
    const named = /logo/i.test(home.ogImage);
    add(home.ogImage, 'og_image', named ? 45 : 20, named ? 'og:image named logo' : 'og:image (checked for photo-likeness on download)', []);
  }
  const fav = home.icons.filter((i) => /^(shortcut )?icon$/i.test(i.rel)).sort((a, b) => sizeOf(b) - sizeOf(a));
  if (fav[0] && (sizeOf(fav[0]) >= 64 || fav[0].sizes === null)) add(fav[0].href, 'favicon', 15, 'favicon', []);
  candidates.sort((a, b) => b.score - a.score);
  return { candidates, rejected };
}
