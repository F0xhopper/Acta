'use server';
// Managed by Acta. Do not edit. Server action for <form action={submitContact}>. Logic lives in contact-core.ts.
import { redirect } from 'next/navigation';
import { deliverContact, validateContact, type ContactInput } from './contact-core';

/** Honeypot field "website" must stay empty. The user always lands on ?sent=1 or ?error=... */
export async function submitContact(formData: FormData): Promise<void> {
  const get = (k: string) => String(formData.get(k) ?? '');
  if (get('website')) redirect('/contact?sent=1');
  const input: ContactInput = { name: get('name'), phone: get('phone'), email: get('email'), message: get('message') };
  const errors = validateContact(input);
  if (errors.length) redirect(`/contact?error=${errors.join(',')}`);
  const ok = await deliverContact(input, get('business') || 'the business');
  redirect(ok ? '/contact?sent=1' : '/contact?error=send');
}
