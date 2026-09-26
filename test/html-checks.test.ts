import { describe, expect, it } from 'vitest';
import { loadScoring } from '../src/config.js';
import { runHtmlChecks } from '../src/audit/html-checks.js';

const scoring = loadScoring();
const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('runHtmlChecks', () => {
  it('detects viewport, title, description, h1', () => {
    const h = runHtmlChecks(page('<h1>Hi</h1>', '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Acme Plumbing | Erdington</title><meta name="description" content="Local plumber">'), {}, 'acme.co.uk', null, scoring);
    expect(h.hasViewport).toBe(true); expect(h.title).toBe('Acme Plumbing | Erdington'); expect(h.metaDescLen).toBe(13); expect(h.h1Count).toBe(1);
  });
  it('accepts a fixed phone-width layout like Wix mobile, rejects a desktop-width one', () => {
    expect(runHtmlChecks(page('<p>x</p>', '<meta name="viewport" content="width=320, user-scalable=yes" id="wixMobileViewport">'), {}, 'a.co.uk', null, scoring).hasViewport).toBe(true);
    expect(runHtmlChecks(page('<p>x</p>', '<meta name="viewport" content="width=980">'), {}, 'a.co.uk', null, scoring).hasViewport).toBe(false);
  });
  it('flags missing viewport', () => { expect(runHtmlChecks(page('<p>old site</p>'), {}, 'acme.co.uk', null, scoring).hasViewport).toBe(false); });
  it('fingerprints builders', () => {
    expect(runHtmlChecks(page('<img src="https://static.wixstatic.com/media/x.jpg">'), {}, 'acme.co.uk', null, scoring).builder).toBe('wix');
    expect(runHtmlChecks(page('<link href="/wp-content/themes/x/style.css">'), {}, 'acme.co.uk', null, scoring).builder).toBe('wordpress');
    expect(runHtmlChecks(page('<img src="https://img1.wsimg.com/x.png">'), {}, 'acme.co.uk', null, scoring).builder).toBe('godaddy');
    expect(runHtmlChecks(page('<p>site</p>'), { 'x-wix-request-id': 'abc' }, 'acme.co.uk', null, scoring).builder).toBe('wix');
  });
  it('flags free-tier hosts', () => {
    expect(runHtmlChecks(page('<p>x</p>'), {}, 'acmeplumbing.wixsite.com', null, scoring).freeTierHost).toBe(true);
    expect(runHtmlChecks(page('<p>x</p>'), {}, 'acmeplumbing.co.uk', null, scoring).freeTierHost).toBe(false);
  });
  it('reads the latest copyright year', () => {
    expect(runHtmlChecks(page('<footer>© 2016 Acme. Copyright 2014-2019 Acme Ltd</footer>'), {}, 'a.co.uk', null, scoring).copyrightYear).toBe(2019);
    expect(runHtmlChecks(page('<footer>no year</footer>'), {}, 'a.co.uk', null, scoring).copyrightYear).toBeNull();
  });
  it('finds phones and compares to listing', () => {
    const h = runHtmlChecks(page('<a href="tel:01211234567">Call</a> or 07700 900123'), {}, 'a.co.uk', '+441211234567', scoring);
    expect(h.phonesOnPage).toContain('+441211234567'); expect(h.phoneMatchesListing).toBe(true);
    expect(runHtmlChecks(page('<p>0121 999 9999</p>'), {}, 'a.co.uk', '+441211234567', scoring).phoneMatchesListing).toBe(false);
  });
  it('detects LocalBusiness schema', () => {
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Acme"}</script>';
    expect(runHtmlChecks(page('<p>x</p>', ld), {}, 'a.co.uk', null, scoring).hasLocalSchema).toBe(true);
    const ws = '<script type="application/ld+json">{"@type":"WebSite"}</script>';
    expect(runHtmlChecks(page('<p>x</p>', ws), {}, 'a.co.uk', null, scoring).hasLocalSchema).toBe(false);
  });
  it('spots limited company hints in the footer', () => {
    expect(runHtmlChecks(page('<footer>Acme Plumbing Ltd. Registered in England, Company No 01234567</footer>'), {}, 'a.co.uk', null, scoring).ltdHint).toBe(true);
    expect(runHtmlChecks(page('<footer>Acme Plumbing, Erdington</footer>'), {}, 'a.co.uk', null, scoring).ltdHint).toBe(false);
  });
});
