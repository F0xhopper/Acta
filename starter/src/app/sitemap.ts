import type { MetadataRoute } from 'next';
import site from '@/content/site';
import { siteUrl } from '@/kit/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, priority: 1 },
    { url: `${base}/about`, lastModified: now, priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, priority: 0.8 },
    ...site.services.map((s) => ({ url: `${base}/services/${s.slug}`, lastModified: now, priority: 0.9 })),
    ...site.areas.map((a) => ({ url: `${base}/areas/${a.slug}`, lastModified: now, priority: 0.7 })),
  ];
}
