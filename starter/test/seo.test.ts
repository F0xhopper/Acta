import { describe, expect, it } from 'vitest';
import { localBusinessJsonLd, openingHoursSpec, rootMetadata } from '@/kit/seo';
import site from '@/content/site';

describe('seo', () => {
  it('converts Google hours lines to schema.org openingHours', () => {
    expect(openingHoursSpec(['Monday: 9:00 am – 5:30 pm', 'Sunday: Closed', 'Saturday: 8:00 AM – 12:00 PM'])).toEqual(['Mo 09:00-17:30', 'Sa 08:00-12:00']);
  });
  it('builds LocalBusiness JSON-LD with rating only when reviews exist', () => {
    const ld = localBusinessJsonLd(site);
    expect(ld['@type']).toBe('LocalBusiness');
    expect(ld.telephone).toBe(site.business.phone_e164 ?? undefined);
    const unrated = localBusinessJsonLd({ ...site, business: { ...site.business, rating: null, review_count: null } });
    expect(unrated.aggregateRating).toBeUndefined();
    const rated = localBusinessJsonLd({ ...site, business: { ...site.business, rating: 4.8, review_count: 12 } });
    expect(rated.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4.8, reviewCount: 12 });
  });
  it('root metadata carries a title template and preview robots', () => {
    const m = rootMetadata(site);
    expect((m.title as { template: string }).template).toContain(site.business.name);
    const preview = process.env.ACTA_PREVIEW === '1';
    expect(m.robots).toEqual(preview ? { index: false, follow: false } : { index: true, follow: true });
  });
});
