import type { PageData, PageImage } from './types.js';
import { looksLikeBadge } from './types.js';

export interface SitePhotoPick { src: string; alt: string | null; pageUrl: string; width: number; height: number }

/** Photos worth reusing: big, not a logo, not a badge, not an icon. */
export function selectSitePhotos(pages: PageData[], logoUrls: string[], max = 12): SitePhotoPick[] {
  const out: SitePhotoPick[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const img of p.images) {
      if (img.inHeader || seen.has(img.src)) continue;
      if (logoUrls.includes(img.src)) continue;
      if (/\.svg(\?|$)/i.test(img.src) || /^data:/i.test(img.src)) continue;
      if (img.width !== 0 && img.width < 600) continue;
      if (/logo|icon|badge|sprite|placeholder|spinner|loading|pixel|tracking/i.test(`${img.src} ${img.alt ?? ''} ${img.className ?? ''}`)) continue;
      if (looksLikeBadge(img.src, img.alt, img.title, img.className, img.nearText)) continue;
      seen.add(img.src);
      out.push({ src: img.src, alt: img.alt, pageUrl: p.url, width: img.width, height: img.height });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export const isPhotoLike = (img: PageImage) => img.width >= 600 && img.height >= 300;
