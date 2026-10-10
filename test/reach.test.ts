import { describe, expect, it } from 'vitest';
import { bestEmail, contactLinks, extractContacts, socialOf } from '../src/audit/contacts.js';

describe('contact details on a business site', () => {
  const html = `<html><body>
    <a href="mailto:Bookings@OslosBarbers.co.uk?subject=Hi">Email us</a>
    <p>Or write to owner [at] oslosbarbers.co.uk</p>
    <img src="logo@2x.png"><p>Template by someone@wixpress.com</p>
    <a href="https://www.instagram.com/oslosbarbers/">Instagram</a>
    <a href="https://facebook.com/sharer.php?u=x">Share</a>
    <a href="https://m.facebook.com/oslosbarbers">Facebook</a>
    <a href="/contact-us">Contact</a><a href="https://other.com/contact">Elsewhere</a>
  </body></html>`;
  it('finds mailto and written-out emails, drops junk', () => {
    const c = extractContacts(html, 'https://oslosbarbers.co.uk/');
    expect(c.emails.sort()).toEqual(['bookings@oslosbarbers.co.uk', 'owner@oslosbarbers.co.uk']);
  });
  it('finds social profiles but not share links', () => {
    const c = extractContacts(html, 'https://oslosbarbers.co.uk/');
    expect(c.socials).toEqual([{ kind: 'instagram', url: 'https://instagram.com/oslosbarbers' }, { kind: 'facebook', url: 'https://facebook.com/oslosbarbers' }]);
    expect(socialOf('https://www.facebook.com/')).toBeNull();
  });
  it('follows contact links on the same site only', () => {
    expect(contactLinks(html, 'https://oslosbarbers.co.uk/')).toEqual(['https://oslosbarbers.co.uk/contact-us']);
  });
  it('prefers an address on their own domain', () => {
    expect(bestEmail(['joe@gmail.com', 'hello@shop.co.uk'], 'www.shop.co.uk')).toBe('hello@shop.co.uk');
  });
});
