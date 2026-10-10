import { describe, expect, it } from 'vitest';
import { parseWebEmailReply, searchWebEmail, verifyEmailPage, webEmailQueue } from '../src/audit/web-email.js';
import type { FullLead } from '../src/db/types.js';

const lead = { name: 'Awa Restaurant', address: 'Rookery Rd, Handsworth, Birmingham B21 9QY', postcode: 'B21 9QY', phone_e164: '+447440528409', website_url: null, found_site_url: null, type_label: 'Restaurant', category_raw: 'cafes' };
const page = (body: string) => `<html><body><h1>Awa Restaurant</h1>${body}</body></html>`;

describe('parseWebEmailReply', () => {
  it('reads the JSON even with prose around it', () => {
    expect(parseWebEmailReply('Here you go: {"email": "Owner@Gmail.com", "source_url": "https://x.co/a", "note": "on a listing"}')).toEqual({ email: 'owner@gmail.com', url: 'https://x.co/a', note: 'on a listing' });
    expect(parseWebEmailReply('{"email": null, "source_url": null, "note": "nothing"}')).toEqual({ email: null, url: null, note: 'nothing' });
    expect(parseWebEmailReply('no json')).toBeNull();
  });
});

describe('verifyEmailPage', () => {
  it('keeps an address shown with their phone or postcode', () => {
    expect(verifyEmailPage(page('Email owner@gmail.com · B21 9QY'), 'https://listing.co.uk/awa', 'owner@gmail.com', lead).ok).toBe(true);
    expect(verifyEmailPage(page('owner@gmail.com, call 07440 528409'), 'https://listing.co.uk/awa', 'owner@gmail.com', lead).ok).toBe(true);
  });
  it('drops an address not on the page, a page that is not theirs, and pages we may not read', () => {
    expect(verifyEmailPage(page('B21 9QY'), 'https://listing.co.uk/awa', 'owner@gmail.com', lead).ok).toBe(false);
    expect(verifyEmailPage(page('owner@gmail.com, Leeds LS1 1AA'), 'https://listing.co.uk/awa', 'owner@gmail.com', lead).ok).toBe(false);
    expect(verifyEmailPage(page('owner@gmail.com B21 9QY'), 'https://www.facebook.com/awa', 'owner@gmail.com', lead).ok).toBe(false);
  });
  it("drops the platform's own mailbox", () => {
    expect(verifyEmailPage(page('help@treatwell.co.uk B21 9QY'), 'https://www.treatwell.co.uk/place/awa', 'help@treatwell.co.uk', lead).ok).toBe(false);
  });
});

describe('searchWebEmail', () => {
  const fetchOk = (body: string) => async () => ({ body, httpStatus: 200, finalUrl: 'https://listing.co.uk/awa' }) as never;
  const noRender = async () => ({ html: null, finalUrl: null });
  it('trusts the page, not the agent', async () => {
    const ask = async () => '{"email": "owner@gmail.com", "source_url": "https://listing.co.uk/awa", "note": "x"}';
    expect((await searchWebEmail(lead, null, { ask, fetch: fetchOk(page('owner@gmail.com B21 9QY')), render: noRender })).email).toBe('owner@gmail.com');
    const r = await searchWebEmail(lead, null, { ask, fetch: fetchOk(page('B21 9QY')), render: noRender });
    expect(r.email).toBeNull();
    expect(r.note).toMatch(/couldn't confirm/);
  });
});

describe('webEmailQueue', () => {
  const f = (id: number, ltd: boolean, total: number, searched = false) => ({ lead: { id, email_search_at: searched ? 'x' : null }, ch: ltd ? { match_confidence: 'high' } : null, score: { total } }) as unknown as FullLead;
  it('limited companies first, then by score, skipping searched and emailed', () => {
    const q = webEmailQueue([f(1, false, 90), f(2, true, 50), f(3, true, 70), f(4, true, 99, true), f(5, true, 95)], (x) => x.lead.id === 5);
    expect(q.map((x) => x.lead.id)).toEqual([3, 2, 1]);
  });
});
