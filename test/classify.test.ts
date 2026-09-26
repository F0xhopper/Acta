import { describe, expect, it } from 'vitest';
import { loadScoring } from '../src/config.js';
import { classifyFetch, classifyUrl } from '../src/audit/classify.js';

const scoring = loadScoring();
const base = { httpStatus: 200, error: null, tlsError: null, redirectLoop: false, contentType: 'text/html', body: '<html><body>' + 'x'.repeat(500) + '</body></html>' };

describe('classifyUrl', () => {
  it('none for empty', () => { expect(classifyUrl(null, scoring).status).toBe('none'); expect(classifyUrl('  ', scoring).status).toBe('none'); });
  it('social hosts', () => {
    expect(classifyUrl('https://www.facebook.com/acmeplumbing', scoring).status).toBe('facebook_only');
    expect(classifyUrl('https://instagram.com/acme', scoring).status).toBe('facebook_only');
    expect(classifyUrl('https://linktr.ee/acme', scoring).status).toBe('facebook_only');
  });
  it('directory hosts including dead Google free sites', () => {
    expect(classifyUrl('https://www.yell.com/biz/acme-123', scoring).status).toBe('directory_only');
    expect(classifyUrl('https://acme-plumbing.business.site', scoring).status).toBe('directory_only');
    expect(classifyUrl('https://www.checkatrade.com/trades/acme', scoring).status).toBe('directory_only');
  });
  it('platforms', () => {
    expect(classifyUrl('https://www.fresha.com/a/acme-nails', scoring).status).toBe('platform_only');
    expect(classifyUrl('https://acme.square.site', scoring).status).toBe('platform_only');
  });
  it('real sites need a fetch, scheme added when missing', () => {
    const c = classifyUrl('acmeplumbing.co.uk', scoring);
    expect(c.status).toBe('fetch');
    if (c.status === 'fetch') expect(c.url).toBe('http://acmeplumbing.co.uk');
  });
});

describe('classifyFetch', () => {
  it('live for a normal page', () => { expect(classifyFetch(base, scoring)).toBe('live'); });
  it('down for network errors and 5xx', () => {
    expect(classifyFetch({ ...base, httpStatus: null, error: 'ENOTFOUND' }, scoring)).toBe('down');
    expect(classifyFetch({ ...base, httpStatus: 503 }, scoring)).toBe('down');
  });
  it('broken for 4xx, TLS errors, loops, parked pages', () => {
    expect(classifyFetch({ ...base, httpStatus: 404 }, scoring)).toBe('broken');
    expect(classifyFetch({ ...base, tlsError: 'CERT_HAS_EXPIRED' }, scoring)).toBe('broken');
    expect(classifyFetch({ ...base, redirectLoop: true }, scoring)).toBe('broken');
    expect(classifyFetch({ ...base, body: '<html><body>This domain is for sale. Buy this domain today.' + 'x'.repeat(300) }, scoring)).toBe('broken');
    expect(classifyFetch({ ...base, body: '<html></html>' }, scoring)).toBe('broken');
  });
  it('does not mistake a real site for a parked one because of substrings in scripts', () => {
    const real = '<html><head><title>Electric Boiler Servicing | JMC</title><script>var parsedOptions={sedo:1};</script></head><body><h1>Boilers</h1><p>Call us today, we are parked outside Erdington all week.</p>' + 'x'.repeat(400) + '</body></html>';
    expect(classifyFetch({ ...base, body: real }, scoring)).toBe('live');
    const parked = '<html><body><p>This domain is parked free, courtesy of sedoparking.com</p>' + 'x'.repeat(400) + '</body></html>';
    expect(classifyFetch({ ...base, body: parked }, scoring)).toBe('broken');
  });
});
