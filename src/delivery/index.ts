/**
 * The delivery package for an approved preview: everything needed to pitch it, in out/deliveries/<slug>/.
 * Email is a draft that opens in Mail; nothing is sent from here.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { OUT_DIR, ROOT } from '../config.js';
import { getFullLead } from '../db/queries.js';
import type { FullLead } from '../db/types.js';
import { getBuild } from '../build/queries.js';
import { loadSiteTypes } from '../build/site-type.js';
import { displayUkPhone } from '../util/phone.js';
import { hostOf } from '../util/http.js';
import type { Delivery } from '../ui/api-types.js';
import { fileUrl } from '../ui/files.js';

const OfferSchema = z.object({
  sender: z.object({ name: z.string(), trading_name: z.string(), phone: z.string(), email: z.string(), website: z.string(), postal_address: z.string(), area: z.string().default('Birmingham') }),
  prices: z.record(z.string(), z.object({ build: z.number(), monthly: z.number() })),
});
export type Offer = z.infer<typeof OfferSchema>;
/** Your sender details: config/offer.yaml (private, not committed), else the committed example with placeholders. */
export const loadOffer = (): Offer => {
  const own = join(ROOT, 'config', 'offer.yaml');
  return OfferSchema.parse(parseYaml(readFileSync(existsSync(own) ? own : join(ROOT, 'config', 'offer.example.yaml'), 'utf8')));
};

export const DELIVERIES_DIR = join(OUT_DIR, 'deliveries');
export const deliveryDir = (slug: string) => join(DELIVERIES_DIR, slug);

/** "Oslo's Barbers Ltd" -> "Oslo's Barbers". */
export const shortName = (name: string) => name.replace(/[\s,]+(ltd\.?|limited|llp|plc)$/i, '').trim();

export function siteTypeName(categoryKey: string): string {
  const f = loadSiteTypes();
  return Object.entries(f.types).find(([, t]) => t.categories.includes(categoryKey))?.[0] ?? f.default;
}

export function priceFor(categoryKey: string, offer: Offer) {
  return offer.prices[siteTypeName(categoryKey)] ?? offer.prices.default ?? { build: 395, monthly: 25 };
}

/** The specific problem, in the owner's terms, for the opening line. */
export function emailHook(full: Pick<FullLead, 'lead' | 'audit'>): string {
  const a = full.audit;
  const host = a?.final_domain ?? (full.lead.website_url ? hostOf(full.lead.website_url.startsWith('http') ? full.lead.website_url : `http://${full.lead.website_url}`) : null);
  switch (a?.website_status) {
    case 'none': return "there's no website on your Google listing, so people who find you there have nowhere to go";
    case 'down': return a.error === 'ENOTFOUND' && host ? `the website on your Google listing, ${host}, no longer exists, so anyone who taps it gets nothing` : `the website on your Google listing isn't loading${host ? ` (${host})` : ''}`;
    case 'broken': return `the website on your Google listing${host ? `, ${host},` : ''} shows an error instead of your business`;
    case 'facebook_only': return 'your Google listing only links to a Facebook page rather than a site of your own';
    case 'directory_only': return 'your Google listing only links to a directory page rather than a site of your own';
    case 'platform_only': return 'your Google listing only links to a booking page rather than a site of your own';
    case 'live': {
      if (a.has_viewport === 0) return "your website doesn't work well on phones, which is where most people will find you";
      if (a.lh_perf !== null && a.lh_perf < 50) return `your website is slow on phones (Google scores it ${a.lh_perf} out of 100)`;
      if (a.https_ok === 0) return 'your website shows as "not secure" in browsers';
      return 'your website could be doing a lot more for you';
    }
    default: return "you don't have a website people can find from Google";
  }
}

const upsellLine = (upsells: string[]) => {
  const u = upsells[0];
  if (!u) return 'I can also sort a .co.uk domain and a proper email address.';
  return `I can also ${u.charAt(0).toLowerCase()}${u.slice(1).replace(/\.$/, '')}.`;
};

export interface EmailInput { businessName: string; hook: string; previewUrl: string; rating: number | null; reviews: number; price: { build: number; monthly: number }; upsells: string[]; sender: Offer['sender'] }

/** Subject and body. Plain text, one link, one price, the opt-out and postal address at the foot. */
export function emailText(i: EmailInput): { subject: string; body: string } {
  const name = shortName(i.businessName);
  const proof = i.rating && i.reviews ? `your ${i.rating} from ${i.reviews} Google reviews, ` : '';
  const body = [
    'Hi there,',
    '',
    `I'm ${i.sender.name}, a web developer in ${i.sender.area}. I noticed ${i.hook}, so I built ${name} a new one to show what it could look like:`,
    '',
    i.previewUrl,
    '',
    `It's made for phones, loads fast, and shows ${proof}your hours and a one-tap call button.`,
    '',
    `If you'd like it, it's £${i.price.build} to finish with your own photos and words, then £${i.price.monthly} a month for hosting and any changes. ${upsellLine(i.upsells)}`,
    '',
    'Happy to change anything. No pressure either way.',
    '',
    i.sender.name,
    `${i.sender.phone} · ${i.sender.website}`,
    '',
    `${i.sender.trading_name}, ${i.sender.postal_address}. Reply "no thanks" and I won't contact you again.`,
  ].join('\n');
  return { subject: `Made you a quick website mock-up, ${name}`, body };
}

export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[a-z0-9£]/i.test(w)).length;

export function complianceNote(emailAllowed: boolean): string {
  return emailAllowed
    ? 'Limited company: cold email allowed. Include your postal address and the opt-out (already in the draft).'
    : 'Sole trader or unknown: do not cold email. Call or walk in with the script; email only if they ask for it.';
}

export function whatsappText(name: string, hook: string, url: string, price: { build: number; monthly: number }, sender: Offer['sender']): string {
  return `Hi, it's ${sender.name}, the web developer from earlier. Here's the site I made for ${shortName(name)}: ${url}\nIt's £${price.build} to finish with your own photos, then £${price.monthly} a month. Happy to change anything.`;
}

export function scriptText(channel: string, name: string, hook: string, price: { build: number; monthly: number }, sender: Offer['sender'], phone: string | null): string {
  const n = shortName(name);
  if (channel === 'walk_in') {
    return [
      'Walk in mid-afternoon when it is quiet. Have the preview open on your phone.',
      '',
      `"Hi, are you the owner? I'm ${sender.name}, I build websites, I'm local in ${sender.area}. I noticed ${hook}, so I made ${n} a new one. Can I show you? It takes ten seconds."`,
      '',
      `Show it. Say the price plainly: £${price.build} to finish, then £${price.monthly} a month. Leave your card with the link. Two minutes, unless they ask questions.`,
      '',
      'If they say no: "No problem, thanks for your time." Mark it lost in Acta.',
    ].join('\n');
  }
  return [
    `Call ${phone ?? 'the number on their Google listing'} between 9 and 11 or 2 and 4. Not Mondays.`,
    '',
    `"Hi, is that the owner of ${n}? I'm ${sender.name}, a web developer in ${sender.area}. I noticed ${hook}, and I've actually built you a new site already. Can I text you the link so you can look when you've got a minute?"`,
    '',
    `If yes: send the WhatsApp text. If they ask the price: £${price.build} to finish, then £${price.monthly} a month, say it plainly.`,
    'If no: "No problem, thanks for your time." Mark it lost in Acta.',
  ].join('\n');
}

/** Bullets under a heading in a markdown file. */
export function bulletsUnder(md: string, heading: RegExp): string[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && heading.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    const m = l.match(/^\s*[-*]\s+(.*)$/);
    if (m) out.push(m[1].replace(/\*\*/g, '').trim());
  }
  return out;
}

function ownerQuestions(siteDir: string): string[] {
  const plan = join(siteDir, 'acta', 'plan.md');
  if (existsSync(plan)) { const b = bulletsUnder(readFileSync(plan, 'utf8'), /content gaps/i); if (b.length) return b; }
  const logf = join(siteDir, 'acta', 'build-log.md');
  if (existsSync(logf)) return bulletsUnder(readFileSync(logf, 'utf8'), /question|owner|could not resolve/i);
  return [];
}

const b64lines = (buf: Buffer) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');

export function emlText(from: string, to: string | null, subject: string, body: string, attachment: { name: string; data: Buffer } | null): string {
  const boundary = `acta-${Date.now().toString(36)}`;
  const enc = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
  const head = [
    `From: ${from}`, ...(to ? [`To: ${to}`] : []), `Subject: ${enc(subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(body, 'utf8')),
  ];
  if (attachment) head.push(`--${boundary}`, `Content-Type: image/png; name="${attachment.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${attachment.name}"`, '', b64lines(attachment.data));
  head.push(`--${boundary}--`, '');
  return head.join('\r\n');
}

type Stored = Delivery;

/** Sender fields in config/offer.yaml still holding [placeholders]. Sending is blocked until they are filled in. */
export function senderMissing(offer: Offer = loadOffer()): string[] {
  return Object.entries(offer.sender).filter(([, v]) => typeof v !== 'string' || !v.trim() || /\[.*\]/.test(v)).map(([k]) => k.replace(/_/g, ' '));
}

export function readDelivery(slug: string): Stored | null {
  const f = join(deliveryDir(slug), 'delivery.json');
  if (!existsSync(f)) return null;
  try {
    const d = JSON.parse(readFileSync(f, 'utf8')) as Stored;
    return { ...d, sentAt: d.sentAt ?? null, sentChannel: d.sentChannel ?? null, phone: d.phone ?? null, phoneE164: d.phoneE164 ?? null, senderMissing: senderMissing() };
  } catch { return null; }
}

/** Write the text files, the .eml and the zip from a delivery object. */
function writeArtifacts(d: Stored, compareSrc: string | null) {
  const dir = deliveryDir(d.slug);
  const offer = loadOffer();
  writeFileSync(join(dir, 'email.txt'), `Subject: ${d.subject}\n\n${d.body}\n`);
  const att = compareSrc && existsSync(compareSrc) ? { name: 'before-and-after.png', data: readFileSync(compareSrc) } : null;
  writeFileSync(join(dir, 'email.eml'), emlText(offer.sender.email, d.to, d.subject, d.body, att));
  writeFileSync(join(dir, 'whatsapp.txt'), d.whatsapp + '\n');
  writeFileSync(join(dir, 'script.txt'), d.script + '\n');
  writeFileSync(join(dir, 'delivery.json'), JSON.stringify(d, null, 2));
  const zip = join(dir, 'package.zip');
  rmSync(zip, { force: true });
  try { execSync('zip -r -q package.zip . -x package.zip', { cwd: dir }); } catch { /* zip missing: package.zip absent */ }
}

export function generateDelivery(slug: string): Delivery {
  const full = getFullLead(slug);
  if (!full) throw new Error(`No lead ${slug}`);
  const b = getBuild(full.lead.id);
  const offer = loadOffer();
  const siteDir = join(ROOT, 'sites', slug);
  const dir = deliveryDir(slug);
  mkdirSync(dir, { recursive: true });
  let upsells: string[] = [];
  let email: string | null = null;
  try { upsells = JSON.parse(readFileSync(join(siteDir, 'acta', 'brand.json'), 'utf8')).quality?.upsells ?? []; } catch { /* none */ }
  try { email = JSON.parse(readFileSync(join(siteDir, 'acta', 'facts.json'), 'utf8')).business?.email ?? null; } catch { /* none */ }
  const price = priceFor(full.lead.category_key, offer);
  const previewUrl = b?.preview_url ?? null;
  const hook = emailHook(full);
  const { subject, body } = emailText({ businessName: full.lead.name, hook, previewUrl: previewUrl ?? '[preview link]', rating: full.lead.rating, reviews: full.lead.review_count ?? 0, price, upsells, sender: offer.sender });
  const emailAllowed = full.ch?.match_confidence === 'high';
  const channel = emailAllowed ? 'email' : (full.score?.channel ?? 'phone') === 'email' ? 'phone' : full.score?.channel ?? 'phone';
  const phone = full.lead.phone_e164 ? displayUkPhone(full.lead.phone_e164) : null;
  const compareSrc = b?.evidence_path && existsSync(b.evidence_path) ? b.evidence_path : existsSync(join(siteDir, 'acta', 'qa', 'compare.png')) ? join(siteDir, 'acta', 'qa', 'compare.png') : null;
  if (compareSrc) copyFileSync(compareSrc, join(dir, 'compare.png'));
  const mob = join(siteDir, 'acta', 'qa', 'hero-mobile.png');
  if (existsSync(mob)) copyFileSync(mob, join(dir, 'preview-mobile.png'));
  const questions = ownerQuestions(siteDir);
  writeFileSync(join(dir, 'owner-questions.md'), `# Questions for ${shortName(full.lead.name)}\n\n${questions.map((q) => `- ${q}`).join('\n') || '- None recorded.'}\n`);
  const prev = readDelivery(slug);
  const d: Stored = {
    slug, createdAt: new Date().toISOString(), channel, emailAllowed,
    zipUrl: `/files/delivery/${encodeURIComponent(slug)}/package.zip`,
    to: email, phone, phoneE164: full.lead.phone_e164 ?? null, subject, body,
    whatsapp: whatsappText(full.lead.name, hook, previewUrl ?? '[preview link]', price, offer.sender),
    script: scriptText(channel, full.lead.name, hook, price, offer.sender, phone),
    ownerQuestions: questions,
    previewUrl,
    compareUrl: existsSync(join(dir, 'compare.png')) ? `/files/delivery/${encodeURIComponent(slug)}/compare.png` : null,
    ogUrl: previewUrl ? `${previewUrl.replace(/\/$/, '')}/opengraph-image` : null,
    emlUrl: `/files/delivery/${encodeURIComponent(slug)}/email.eml`,
    price: { build: price.build, monthly: price.monthly, currency: 'GBP' },
    upsells,
    complianceNote: complianceNote(emailAllowed),
    senderMissing: senderMissing(offer),
    sentAt: prev?.sentAt ?? null, sentChannel: prev?.sentChannel ?? null,
  };
  writeFileSync(join(dir, 'summary.md'), [
    `# ${full.lead.name}`, '',
    `- Preview: ${previewUrl ?? 'not deployed'}`, `- Repo: ${b?.repo_url ?? 'none'}`,
    `- Area: ${full.lead.area}`, `- Phone: ${phone ?? 'none'}`, `- Rating: ${full.lead.rating ?? '-'} from ${full.lead.review_count ?? 0} reviews`,
    `- Tier ${full.score?.tier ?? '-'}, score ${full.score?.total ?? '-'} (opportunity ${full.score?.opportunity ?? '-'}, viability ${full.score?.viability ?? '-'})`,
    `- Price: £${price.build} then £${price.monthly}/month`, `- Upsells: ${upsells.join('; ') || 'none'}`,
    `- Channel: ${channel}`, `- ${d.complianceNote}`, '',
  ].join('\n'));
  writeArtifacts(d, compareSrc);
  return d;
}

export function updateDelivery(slug: string, patch: Partial<Pick<Delivery, 'subject' | 'body' | 'whatsapp'>>): Delivery {
  const d = readDelivery(slug);
  if (!d) throw new Error('No delivery yet: approve the build or generate one first');
  const next: Stored = { ...d, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'string')) };
  const compare = join(deliveryDir(slug), 'compare.png');
  writeArtifacts(next, existsSync(compare) ? compare : null);
  return next;
}

export function markSent(slug: string, channel: string | null): Stored | null {
  const d = readDelivery(slug);
  if (!d) return null;
  const next: Stored = { ...d, sentAt: channel ? new Date().toISOString() : null, sentChannel: channel };
  writeFileSync(join(deliveryDir(slug), 'delivery.json'), JSON.stringify(next, null, 2));
  return next;
}

export const deliveryFile = (slug: string, name: string) => join(deliveryDir(slug), basename(name));
export { fileUrl };
