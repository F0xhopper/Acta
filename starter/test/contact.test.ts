import { describe, expect, it } from 'vitest';
import { validateContact } from '@/kit/contact-core';

describe('contact validation', () => {
  it('needs a name, a way to reply and a message', () => {
    expect(validateContact({ name: '', phone: '', email: '', message: '' })).toEqual(['name', 'contact', 'message']);
    expect(validateContact({ name: 'A', phone: '07700 900123', email: '', message: 'hi' })).toEqual([]);
    expect(validateContact({ name: 'A', phone: '', email: 'not-an-email', message: 'hi' })).toEqual(['email']);
  });
});
