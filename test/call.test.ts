import { describe, expect, it } from 'vitest';
import { callScript, needsCall } from '../src/pick/call.js';
import type { FullLead } from '../src/db/types.js';
import type { Offer } from '../src/delivery/index.js';

const offer: Offer = { sender: { name: 'Eden', trading_name: 'Acta', phone: '07000 000000', email: 'e@acta.test', website: 'acta.test', postal_address: '1 Road, B1', area: 'Birmingham' }, prices: { default: { build: 395, monthly: 25 } } };
const full = (over: Record<string, unknown> = {}, ch: 'high' | 'none' = 'none', audit: Record<string, unknown> = { website_status: 'none' }): FullLead => ({
  lead: { id: 1, slug: 'x', name: 'Acme Roofing Ltd', category_key: 'roofer', phone_e164: '+447700900123', address: '1 High St', ...over } as never,
  audit: audit as never, score: null, ch: { match_confidence: ch } as never, pipeline: { status: 'new' } as never,
});

describe('the call before the build', () => {
  it('is needed for anyone who cannot be cold emailed', () => {
    expect(needsCall(full())).toBe(true);                                        // sole trader with a mobile
    expect(needsCall(full({ manual_email: 'a@b.com' }))).toBe(true);              // an email, but not a limited company
    expect(needsCall(full({ manual_email: 'a@b.com' }, 'high'))).toBe(false);     // limited company with an email: cold email instead
    expect(needsCall(full({}, 'high'))).toBe(true);                               // limited company, no email
  });
  it('has a script with the hook, the ask, and what each answer does', () => {
    const s = callScript(full(), offer);
    expect(s.phone).toBe('07700 900123');
    expect(s.whatsapp).toBe(true);
    expect(s.lines.join('\n')).toMatch(/Call 07700 900123/);
    expect(s.lines.join('\n')).toMatch(/owner of Acme Roofing\?/);
    expect(s.lines.join('\n')).toMatch(/no website on your Google listing/);
    expect(s.lines.join('\n')).toMatch(/WhatsApp it to this number/);
    expect(s.lines.join('\n')).toMatch(/Press Yes/);
    expect(s.lines.join('\n')).toMatch(/Press No/);
  });
  it('falls back to a walk-in when there is no phone, and to email when there is no mobile', () => {
    expect(callScript(full({ phone_e164: null }), offer).lines[0]).toMatch(/walk in/);
    expect(callScript(full({ phone_e164: '+441210000000', manual_email: 'a@b.com' }), offer).lines.join('\n')).toMatch(/email it to a@b.com/);
  });
});
