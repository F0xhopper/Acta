// Managed by Acta. Do not edit. Validation and delivery for the contact form (plain module, no server directive).
export interface ContactInput { name: string; phone: string; email: string; message: string }

export function validateContact(input: ContactInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('name');
  if (!input.phone.trim() && !input.email.trim()) errors.push('contact');
  if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) errors.push('email');
  if (!input.message.trim()) errors.push('message');
  return errors;
}

/** Sends via Resend when RESEND_API_KEY and CONTACT_TO are set, otherwise logs. Never throws. */
export async function deliverContact(input: ContactInput, businessName: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  if (!key || !to) {
    console.log('[contact] no RESEND_API_KEY/CONTACT_TO, logging only:', JSON.stringify(input));
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM ?? 'website@notifications.acta.agency',
        to: [to],
        reply_to: input.email.trim() || undefined,
        subject: `New enquiry via ${businessName} website from ${input.name.trim()}`,
        text: `Name: ${input.name}\nPhone: ${input.phone}\nEmail: ${input.email}\n\n${input.message}`,
      }),
    });
    if (!res.ok) console.error('[contact] resend failed', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('[contact] resend error', e);
    return false;
  }
}
