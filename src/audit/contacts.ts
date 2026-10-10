/**
 * Contact details a business publishes on its own website: email addresses (mailto links, plain text, Cloudflare-
 * protected addresses, and addresses inside the page's data, which site builders like Wix use) and social profiles.
 * Read from the homepage and its contact and about pages. Never from Facebook, Google Maps or directories, which
 * must not be scraped.
 */
import * as cheerio from 'cheerio';

export type SocialKind = 'instagram' | 'facebook' | 'tiktok' | 'x' | 'linkedin' | 'youtube';
export interface Social { kind: SocialKind; url: string }
export interface Contacts { emails: string[]; socials: Social[] }

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
/** Addresses that appear on sites but are not the business: placeholders, builders' and trackers' addresses, image names. */
const JUNK = /(\.(png|jpe?g|gif|svg|webp|avif)$|@(example|domain|email|yourdomain|yoursite|test|sentry|wixpress|sentry-next|godaddy|squarespace|shopify|wordpress|mysite)\.|^(name|your|you|user|email|info@example)\b|noreply|no-reply|donotreply|privacy@|abuse@|webmaster@)/i;

/** Mail providers small businesses use. An address in a page's scripts only counts if it's on one of these or the site's own domain. */
const PROVIDERS = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|btinternet|btopenworld|sky|virginmedia|talktalk|ntlworld|blueyonder|protonmail|proton|mail|gmx|zoho)\.[a-z.]+$/i;

/** Cloudflare's email protection: the address hex-encoded and XORed with its first byte. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.includes('@') ? out.toLowerCase() : null;
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

export function socialOf(url: string): Social | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.replace(/^(www\.|m\.|web\.)/, '').toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  if (!path || path === '' || /^\/(sharer|share|intent|plugins|dialog|tr|login|home\.php)/i.test(path)) return null;
  const kind: SocialKind | null = /instagram\.com$/.test(h) ? 'instagram' : /(facebook\.com|fb\.com)$/.test(h) ? 'facebook' : /tiktok\.com$/.test(h) ? 'tiktok'
    : /(twitter\.com|^x\.com)$/.test(h) ? 'x' : /linkedin\.com$/.test(h) ? 'linkedin' : /youtube\.com$/.test(h) ? 'youtube' : null;
  return kind ? { kind, url: `https://${h}${path}` } : null;
}

/** Emails and socials in one page of HTML. Pure. */
export function extractContacts(html: string, baseUrl: string): Contacts {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  const socials = new Map<string, Social>();
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (/^mailto:/i.test(href)) {
      const e = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]).trim().toLowerCase();
      if (e.includes('@')) emails.add(e);
      return;
    }
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { return; }
    const s = socialOf(abs);
    if (s && !socials.has(s.kind)) socials.set(s.kind, s);
  });
  // Cloudflare hides addresses as data-cfemail="..." or /cdn-cgi/l/email-protection#...
  $('[data-cfemail]').each((_, el) => { const e = decodeCfEmail($(el).attr('data-cfemail') ?? ''); if (e) emails.add(e); });
  $('a[href*="email-protection#"]').each((_, el) => { const e = decodeCfEmail(($(el).attr('href') ?? '').split('#')[1] ?? ''); if (e) emails.add(e); });
  // Addresses in scripts and structured data (Wix and other builders keep page content there): own domain or a mail provider only.
  const own = hostOf(baseUrl);
  const raw = $('script').map((_, el) => $(el).html() ?? '').get().join(' ').replace(/\\u0040/gi, '@');
  for (const m of raw.match(EMAIL_RE) ?? []) { const e = m.toLowerCase(); if ((own && e.endsWith(`@${own}`)) || PROVIDERS.test(e)) emails.add(e); }
  $('script, style, noscript').remove();
  // Text node by text node with spaces between, so "Email: a@b.com" next to "Hours open" never reads as "a@b.comhoursopen".
  const nodes: string[] = [];
  $('body').find('*').addBack().contents().each((_, n) => { if (n.type === 'text') nodes.push((n as unknown as { data: string }).data); });
  const text = nodes.join(' ').replace(/\s*\[\s*at\s*\]\s*|\s+\(at\)\s+/gi, '@').replace(/\s*\[\s*dot\s*\]\s*/gi, '.');
  for (const m of text.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase().replace(/\.$/, ''));
  return { emails: [...emails].filter((e) => !JUNK.test(e) && e.length < 80), socials: [...socials.values()] };
}

/** Links on the page that probably lead to contact details, on the same site. Pure. */
export function contactLinks(html: string, baseUrl: string, max = 2): string[] {
  const $ = cheerio.load(html);
  let host = '';
  try { host = new URL(baseUrl).host; } catch { return []; }
  const out: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const label = `${href} ${$(el).text()}`.toLowerCase();
    if (!/contact|get-in-touch|find-us|enquir|book|about/.test(label)) return;
    try { const u = new URL(href, baseUrl); if (u.host === host && !out.includes(u.toString()) && u.toString() !== baseUrl) out.push(u.toString()); } catch { /* skip */ }
  });
  // Contact pages first, then about pages.
  return out.sort((a, b) => Number(/about/i.test(a)) - Number(/about/i.test(b))).slice(0, max);
}

/** Where contact details usually live when the homepage doesn't link them. */
export const COMMON_CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us'];

export function mergeContacts(...all: (Contacts | null | undefined)[]): Contacts {
  const emails = new Set<string>(); const socials = new Map<string, Social>();
  for (const c of all) { for (const e of c?.emails ?? []) emails.add(e); for (const s of c?.socials ?? []) if (!socials.has(s.kind)) socials.set(s.kind, s); }
  return { emails: [...emails], socials: [...socials.values()] };
}

/** The address most likely to be read by the owner: on their own domain first, then a named mailbox, then any. */
export function bestEmail(emails: string[], ownDomain: string | null): string | null {
  if (!emails.length) return null;
  const dom = ownDomain?.replace(/^www\./, '').toLowerCase() ?? '';
  const score = (e: string) => (dom && e.endsWith(`@${dom}`) ? 0 : 1) + (/^(info|hello|enquiries|contact|bookings?|admin|office)@/.test(e) ? 0 : 0.5);
  return [...emails].sort((a, b) => score(a) - score(b))[0];
}
