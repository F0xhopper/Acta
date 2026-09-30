// Managed by Acta. Do not edit.
export const telHref = (e164: string) => `tel:${e164}`;

/** WhatsApp deep link for UK mobiles (+447...). Null for landlines. */
export const waHref = (e164: string | null | undefined): string | null =>
  e164 && /^\+447\d{9}$/.test(e164) ? `https://wa.me/${e164.slice(1)}` : null;
