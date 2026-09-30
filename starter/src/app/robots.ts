import type { MetadataRoute } from 'next';
import { siteUrl } from '@/kit/seo';
import { isPreview } from '@/kit/preview';

export default function robots(): MetadataRoute.Robots {
  if (isPreview()) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/' }, sitemap: `${siteUrl()}/sitemap.xml` };
}
