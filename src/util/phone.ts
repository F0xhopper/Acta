/** Normalise a UK phone number to E.164 (+44...). Returns null if it doesn't look like one. */
export function normaliseUkPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0044')) digits = digits.slice(4);
  else if (digits.startsWith('44')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  else return null;
  // UK national significant numbers are 9 or 10 digits (10 for almost everything we care about).
  if (digits.length < 9 || digits.length > 10) return null;
  if (!/^[1-9]\d+$/.test(digits)) return null;
  return `+44${digits}`;
}

const PHONE_IN_TEXT = /(?:\+44\s?\(?0?\)?[\s-]?\d{2,4}|\(?0\d{2,4}\)?)[\s-]?\d{3,4}[\s-]?\d{3,4}/g;

/** Find UK phone numbers in free text, normalised and deduplicated. */
export function findUkPhones(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PHONE_IN_TEXT)) {
    const n = normaliseUkPhone(m[0]);
    if (n) found.add(n);
  }
  return [...found];
}

/** Human-readable national format for display, e.g. 0121 123 4567. */
export function displayUkPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const national = e164.replace(/^\+44/, '0');
  if (national.startsWith('07')) return `${national.slice(0, 5)} ${national.slice(5)}`;
  if (national.startsWith('020') || national.startsWith('023') || national.startsWith('024') || national.startsWith('028') || national.startsWith('029')) {
    return `${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`;
  }
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}
