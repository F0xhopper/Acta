// Managed by Acta. Do not edit.
import type { Metadata } from 'next';
import type { Site } from './site-schema';
import { isPreview } from './preview';

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

/** Root metadata for layout.tsx. Pages set their own `title`, the template adds the business name. */
export function rootMetadata(site: Site): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: site.meta.title, template: `%s | ${site.business.name}` },
    description: site.meta.description,
    openGraph: {
      type: 'website',
      siteName: site.business.name,
      title: site.meta.title,
      description: site.meta.description,
      locale: 'en_GB',
      images: site.photos[0] ? [{ url: site.photos[0].path, alt: site.photos[0].alt }] : site.logo ? [{ url: site.logo.path, alt: site.logo.alt }] : [],
    },
    robots: isPreview() ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export function pageMetadata(title: string, description: string): Metadata {
  return { title, description, openGraph: { title, description } };
}

/** Google's "Monday: 9:00 am – 5:00 pm" lines to schema.org openingHours ("Mo 09:00-17:00"). Unparseable lines are skipped. */
export function openingHoursSpec(lines: string[]): string[] {
  const days: Record<string, string> = { monday: 'Mo', tuesday: 'Tu', wednesday: 'We', thursday: 'Th', friday: 'Fr', saturday: 'Sa', sunday: 'Su' };
  const to24 = (t: string): string | null => {
    const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = m[2] ?? '00';
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  };
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const day = days[m[1].toLowerCase()];
    if (!day || /closed/i.test(m[2])) continue;
    for (const range of m[2].split(',')) {
      const [a, b] = range.split(/\s*[–-]\s*/);
      const open = a && to24(a.replace(/ | /g, ' '));
      const close = b && to24(b.replace(/ | /g, ' '));
      if (open && close) out.push(`${day} ${open}-${close}`);
    }
  }
  return out;
}

export function localBusinessJsonLd(site: Site): Record<string, unknown> {
  const b = site.business;
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: b.name,
    url: siteUrl(),
    telephone: b.phone_e164 ?? undefined,
    email: b.email ?? undefined,
    image: site.logo ? `${siteUrl()}${site.logo.path}` : undefined,
    address: b.address ? { '@type': 'PostalAddress', streetAddress: b.address, postalCode: b.postcode ?? undefined, addressLocality: b.city, addressCountry: 'GB' } : undefined,
    areaServed: [b.area, ...site.areas.map((a) => a.name)].map((name) => ({ '@type': 'Place', name })),
    openingHours: openingHoursSpec(b.hours),
    sameAs: Object.values(site.social).filter(Boolean),
    hasMap: b.maps_url ?? undefined,
  };
  if (b.review_count && b.rating) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: b.rating, reviewCount: b.review_count };
  return Object.fromEntries(Object.entries(ld).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
}
