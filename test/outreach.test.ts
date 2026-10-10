import { describe, expect, it } from 'vitest';
import { classifyReply, contactsFor, dailyCap, emailBlockers, firstLines, followUpText, inWindow, nextTouch, warmupWeek } from '../src/outreach/rules.js';

const cap = { start_per_day: 3, increase_per_week: 3, max_per_day: 20 };
const f = { days: [3, 8], max_contacts: 3, auto: false };

describe('warm-up cap', () => {
  it('starts low and rises weekly to the max', () => {
    expect(dailyCap(cap, null, '2026-10-08')).toBe(3);
    expect(dailyCap(cap, '2026-10-08', '2026-10-14')).toBe(3);
    expect(dailyCap(cap, '2026-10-08', '2026-10-15')).toBe(6);
    expect(dailyCap(cap, '2026-10-08', '2027-03-01')).toBe(20);
    expect(warmupWeek('2026-10-08', '2026-10-22')).toBe(3);
  });
});

describe('send window', () => {
  const w = { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' };
  it('allows weekday working hours only', () => {
    expect(inWindow(w, new Date(2026, 9, 8, 10, 0))).toBe(true);   // Thursday 10:00
    expect(inWindow(w, new Date(2026, 9, 8, 17, 0))).toBe(false);  // 17:00 is outside
    expect(inWindow(w, new Date(2026, 9, 10, 11, 0))).toBe(false); // Saturday
  });
});

describe('follow-ups', () => {
  const pitched = '2026-10-08T10:00:00.000Z';
  it('schedules day 3, then day 8, then stops at three contacts', () => {
    expect(nextTouch(f, pitched, 1)).toBe('2026-10-11T10:00:00.000Z');
    expect(nextTouch(f, pitched, 2)).toBe('2026-10-16T10:00:00.000Z');
    expect(nextTouch(f, pitched, 3)).toBeNull();
    expect(contactsFor('followup_1')).toBe(2);
  });
  it('writes a short nudge in the same thread with the opt-out and address', () => {
    const t = followUpText(2, true, { businessName: "Oslo's Barbers Ltd", previewUrl: 'https://x.vercel.app', senderName: 'Sam', tradingName: 'Acta Studio', postalAddress: '1 High St, B1', originalSubject: 'Made you a quick website mock-up' });
    expect(t.subject).toBe('Re: Made you a quick website mock-up');
    expect(t.body).toContain("Last note from me");
    expect(t.body).toContain("Oslo's Barbers");
    expect(t.body).toContain('1 High St, B1');
    expect(t.body).toMatch(/won't contact you again/);
  });
});

describe('who may be emailed', () => {
  const ok = { status: 'preview_ready', ltd: true, suppressed: false, to: 'owner@shop.co.uk', senderMissing: [], body: 'Hi. Acta Studio, 1 High St. Reply "no thanks" and I won\'t contact you again.', postalAddress: '1 High St' };
  it('allows a limited company with an address and a compliant body', () => { expect(emailBlockers(ok)).toEqual([]); });
  it('blocks sole traders, the do-not-contact list, missing addresses and missing footers', () => {
    expect(emailBlockers({ ...ok, ltd: false }).join()).toMatch(/PECR/);
    expect(emailBlockers({ ...ok, suppressed: true }).join()).toMatch(/do-not-contact/);
    expect(emailBlockers({ ...ok, to: null }).join()).toMatch(/no email address/);
    expect(emailBlockers({ ...ok, body: 'Hi there' }).length).toBe(2);
    expect(emailBlockers({ ...ok, senderMissing: ['postal address'] }).join()).toMatch(/offer.yaml/);
  });
});

describe('reading replies', () => {
  it('tells a real answer from a stop request and an auto-reply', () => {
    expect(classifyReply('Re: your site', 'Looks great, can you call me tomorrow?')).toBe('reply');
    expect(classifyReply('Re: your site', 'No thanks, please remove me from your list.')).toBe('stop');
    expect(classifyReply('Out of office', 'I am away until Monday.')).toBe('auto');
  });
  it('ignores the quoted original when deciding', () => {
    const text = 'Sounds good, what are the next steps?\n\nOn Thu, 8 Oct 2026 at 10:00, Sam wrote:\n> Reply "no thanks" and I won\'t contact you again.';
    expect(firstLines(text)).toBe('Sounds good, what are the next steps?');
    expect(classifyReply('Re: x', text)).toBe('reply');
  });
});

import { emailText } from '../src/delivery/index.js';
describe('pitch email wording', () => {
  it('reads cleanly when the hook already has a clause in it', () => {
    const { body } = emailText({ businessName: "Oslo's Barbers Ltd", hook: 'the website on your Google listing no longer exists, so anyone who taps it gets nothing', previewUrl: 'https://x', rating: 4.9, reviews: 602, price: { build: 395, monthly: 25 }, upsells: [], sender: { name: 'Eden Phillips', trading_name: 'Acta Studio', phone: '07946 629657', email: 'hello@actastudio.co.uk', website: 'actastudio.co.uk', postal_address: '17 Upper St Marys Road, Birmingham', area: 'Birmingham' } });
    expect(body).toContain("gets nothing. I've built Oslo's Barbers a new one");
    expect(body).not.toMatch(/gets nothing, so I built/);
  });
});
