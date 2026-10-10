import { describe, expect, it, vi } from 'vitest';
import { domainCandidates, findOwnSite, pageMatchesLead } from '../src/audit/find-site.js';
import { decodeCfEmail, extractContacts } from '../src/audit/contacts.js';

describe('domainCandidates', () => {
  it('turns a name into likely domains, dropping Ltd and the like', () => {
    expect(domainCandidates('Shiny Barbers')).toEqual(['shinybarbers.co.uk', 'shinybarbers.com', 'shinybarbers.uk', 'shiny-barbers.co.uk', 'shiny-barbers.com', 'shiny-barbers.uk']);
    expect(domainCandidates("Oslo's Barbers Ltd")[0]).toBe('oslosbarbers.co.uk');
    expect(domainCandidates('Onyx Residential Cleaning Services Birmingham')).toContain('onyxresidentialcleaning.co.uk');
    expect(domainCandidates('T&T')).toEqual([]);
  });
});

describe('pageMatchesLead', () => {
  const lead = { phone_e164: '+441214960000', postcode: 'B14 7JZ' };
  it('matches the phone in any format, or the postcode', () => {
    expect(pageMatchesLead('<p>Call 0121 496 0000</p>', lead)).toBe('phone');
    expect(pageMatchesLead('<p>+44 (0)121 4960000</p>', lead)).toBe('phone');
    expect(pageMatchesLead('<p>66 High St, B14 7JZ</p>', { ...lead, phone_e164: null })).toBe('postcode');
    expect(pageMatchesLead('<p>Another barber in Leeds</p>', lead)).toBeNull();
  });
});

describe('findOwnSite', () => {
  const lead = { id: 1, name: 'Shiny Barbers', phone_e164: '+447307887191', postcode: 'B66 3PJ' } as never;
  const page = (body: string) => ({ body, httpStatus: 200, finalUrl: null }) as never;
  it('keeps the first domain whose page shows their phone, checking the rendered page too', async () => {
    const resolves = vi.fn(async (h: string) => h !== 'shinybarbers.co.uk');
    const fetch = vi.fn(async (u: string) => page(u.includes('shinybarbers.com') ? '<p>Some other shop</p>' : '<p>Book: 07307 887191</p>'));
    const render = vi.fn(async () => ({ html: '<p>Still another shop</p>', finalUrl: null }));
    const r = await findOwnSite(lead, { fetch, render, resolves });
    expect(r).toMatchObject({ url: 'https://shinybarbers.uk', matchedBy: 'phone' });
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('ignores parked domains', async () => {
    const r = await findOwnSite(lead, { fetch: async () => page('This domain is for sale 07307 887191'), render: async () => ({ html: null, finalUrl: null }), resolves: async () => true });
    expect(r).toBeNull();
  });
});

describe('extractContacts, harder cases', () => {
  it('decodes Cloudflare-protected addresses', () => {
    // "info@acme.co.uk" XOR 0x42
    const key = 0x42; const hex = key.toString(16) + [...'info@acme.co.uk'].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
    expect(decodeCfEmail(hex)).toBe('info@acme.co.uk');
    expect(extractContacts(`<a href="/cdn-cgi/l/email-protection#${hex}">[email&#160;protected]</a>`, 'https://acme.co.uk').emails).toEqual(['info@acme.co.uk']);
    expect(extractContacts(`<span class="__cf_email__" data-cfemail="${hex}"></span>`, 'https://acme.co.uk').emails).toEqual(['info@acme.co.uk']);
  });
  it('reads addresses from page data only on their domain or a mail provider', () => {
    const html = '<script>window.data={"email":"bookings\\u0040acme.co.uk","x":"dev@wixpress.com","y":"jo.example@gmail.com","z":"a@cdn-tracker.io"}</script>';
    expect(extractContacts(html, 'https://www.acme.co.uk').emails.sort()).toEqual(['bookings@acme.co.uk', 'jo.example@gmail.com']);
  });
});

describe('extractContacts keeps neighbouring text out of addresses', () => {
  it('splits text that sits in separate elements', () => {
    const html = '<div><span>0262</span><span>info@acme-agile.co.uk</span></div><p>acmebuilders@hotmail.com</p><p>Hours open</p><a>acme.orthodontics@nhs.net</a><b>Click</b>';
    expect(extractContacts(html, 'https://acme-agile.co.uk').emails.sort()).toEqual(['acme.orthodontics@nhs.net', 'acmebuilders@hotmail.com', 'info@acme-agile.co.uk']);
  });
});
