import { describe, expect, it } from 'vitest';
import { SiteSchema } from '@/kit/site-schema';
import site from '@/content/site';

describe('site.ts', () => {
  it('placeholder satisfies the schema', () => { expect(() => SiteSchema.parse(site)).not.toThrow(); });
  it('rejects a bad phone and a bad slug', () => {
    expect(SiteSchema.safeParse({ ...site, business: { ...site.business, phone_e164: '0121 000 0000' } }).success).toBe(false);
    expect(SiteSchema.safeParse({ ...site, services: [{ ...site.services[0], slug: 'Bad Slug' }] }).success).toBe(false);
  });
});
