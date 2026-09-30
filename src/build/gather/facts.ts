import type { Claim } from './claims-types.js';
import type { PageData } from './types.js';

export const BIRMINGHAM_AREAS = ['Erdington', 'Kings Heath', 'Moseley', 'Harborne', 'Stirchley', 'Bearwood', 'Selly Oak', 'Sparkhill', 'Small Heath', 'Handsworth', 'Alum Rock', 'Sutton Coldfield', 'Solihull', 'Edgbaston', 'Hall Green', 'Acocks Green', 'Yardley', 'Sheldon', 'Northfield', 'Kings Norton', 'Bournville', 'Cotteridge', 'Digbeth', 'Jewellery Quarter', 'Kingstanding', 'Great Barr', 'Castle Bromwich', 'Quinton', 'Boldmere', 'Shirley', 'Perry Barr', 'Aston', 'Nechells', 'Ladywood', 'Balsall Heath', 'Sparkbrook', 'Longbridge', 'Rubery', 'Weoley Castle', 'Bartley Green', 'Hodge Hill', 'Ward End', 'Bordesley Green', 'Tyseley', 'Olton', 'Knowle', 'Dorridge', 'Wylde Green', 'Four Oaks', 'Mere Green', 'Streetly', 'West Bromwich', 'Oldbury', 'Smethwick', 'Dudley', 'Walsall', 'Wolverhampton', 'Coventry'];

export const SERVICES_BY_CATEGORY: Record<string, string[]> = {
  plumber: ['Boiler repair', 'Boiler installation', 'Bathroom fitting', 'Leak repair', 'Emergency plumbing'],
  electrician: ['Rewiring', 'Consumer unit upgrades', 'EICR certificates', 'Lighting', 'EV charger installation'],
  roofer: ['Roof repairs', 'New roofs', 'Flat roofing', 'Guttering and fascias', 'Chimney work'],
  builder: ['Extensions', 'Loft conversions', 'Renovations', 'Garden rooms', 'Brickwork'],
  landscaper: ['Garden design', 'Patios and paving', 'Fencing', 'Turfing', 'Decking'],
  cleaner: ['Domestic cleaning', 'End of tenancy cleaning', 'Deep cleans', 'Office cleaning', 'Carpet cleaning'],
  garage: ['MOT testing', 'Servicing', 'Diagnostics', 'Brakes and tyres', 'Repairs'],
  barber: ['Haircuts', 'Skin fades', 'Beard trims', 'Hot towel shaves'],
  beauty: ['Nails', 'Lashes', 'Brows', 'Facials', 'Waxing'],
  cafe: ['Breakfast', 'Lunch', 'Coffee', 'Cakes'],
  takeaway: ['Collection', 'Delivery', 'Meal deals', 'Catering'],
  restaurant: ['Lunch', 'Dinner', 'Bookings', 'Private hire'],
  dentist: ['Check-ups', 'Hygienist', 'Whitening', 'Invisalign', 'Emergency dental'],
  accountant: ['Self assessment', 'Limited company accounts', 'Bookkeeping', 'VAT returns', 'Payroll'],
  physio: ['Sports injuries', 'Back and neck pain', 'Post-surgery rehab', 'Sports massage'],
  removals: ['House removals', 'Office moves', 'Man and van', 'Packing', 'Storage'],
  locksmith: ['Emergency lockouts', 'Lock changes', 'UPVC door repairs', 'Security upgrades'],
  pet: ['Full groom', 'Bath and brush', 'Nail clipping', 'Puppy groom'],
  personal_trainer: ['1-to-1 personal training', 'Small group training', 'Online coaching', 'Nutrition plans'],
  estate_agent: ['Sales', 'Lettings', 'Property management', 'Valuations'],
  life_coach: ['1-to-1 coaching', 'Discovery call', 'Group programmes', 'Workshops'],
  coach_hire: ['Coach hire', 'Minibus hire', 'Airport transfers', 'School and event travel'],
  solicitor: ['Conveyancing', 'Family law', 'Wills and probate', 'Immigration', 'Employment law'],
  driving_school: ['Manual lessons', 'Automatic lessons', 'Intensive courses', 'Pass Plus'],
  decorator: ['Interior painting', 'Exterior painting', 'Wallpapering', 'Plastering'],
  fitter: ['Kitchen fitting', 'Bathroom fitting', 'Flooring', 'Carpentry', 'Handyman jobs'],
  window_cleaner: ['Window cleaning', 'Gutter cleaning', 'Pressure washing', 'Conservatory cleaning'],
  florist: ['Bouquets', 'Weddings', 'Funerals', 'Same-day delivery'],
  tattoo: ['Custom tattoos', 'Cover-ups', 'Piercings', 'Consultations'],
  photographer: ['Weddings', 'Portraits', 'Events', 'Commercial'],
  tutor: ['GCSE tuition', 'A-level tuition', '11+ preparation', 'Online lessons'],
  childcare: ['Baby room', 'Toddlers', 'Pre-school', 'Funded hours'],
  vet: ['Consultations', 'Vaccinations', 'Surgery', 'Dental', 'Pet health plans'],
};

const NAV_BOILERPLATE = /^(home|about( us)?|contact( us)?|gallery|blog|news|reviews?|testimonials|faqs?|privacy|terms|book( now)?|menu|shop|login|sign in|our team|team|careers|areas?( we cover)?|services?)$/i;

export function extractServices(pages: PageData[], categoryKey: string): { name: string; source: 'site' | 'category'; evidence: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; source: 'site' | 'category'; evidence: string | null }[] = [];
  const serviceish = pages.filter((p) => /service|treatment|price|menu|what-we-do|our-work/i.test(p.url) || pages.indexOf(p) === 0);
  for (const p of serviceish) {
    for (const raw of [...p.headings, ...p.navTexts]) {
      let t = raw.replace(/\s+/g, ' ').trim().replace(/[.:!]+$/, '');
      if (/[?,.\d]/.test(t) || /\b(plan|results?|start|now|proven|real|clear|access|involved|why|how|what|get|your|our|we|you)\b/i.test(t)) continue;
      if (t === t.toUpperCase()) t = t.split(/(\s+|\/)/).map((w) => (w.length <= 2 && /^[A-Z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
      const words = t.split(' ');
      if (words.length < 2 || words.length > 5 || t.length > 40) continue;
      if (NAV_BOILERPLATE.test(t)) continue;
      if (/^(welcome|why choose|get in touch|call us|contact|follow|opening|find us|our (story|mission|promise|values))/i.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: t, source: 'site', evidence: raw.trim() });
      if (out.length >= 8) break;
    }
    if (out.length >= 8) break;
  }
  if (out.length >= 3) return out;
  for (const s of SERVICES_BY_CATEGORY[categoryKey] ?? ['Our services']) {
    if (!seen.has(s.toLowerCase())) { out.push({ name: s, source: 'category', evidence: null }); seen.add(s.toLowerCase()); }
  }
  return out;
}

export function extractAreas(text: string, leadArea: string, max = 8): string[] {
  const out: string[] = [leadArea];
  const lower = text.toLowerCase();
  for (const a of BIRMINGHAM_AREAS) {
    if (out.includes(a)) continue;
    if (new RegExp(`(^|[^a-z])${a.toLowerCase()}([^a-z]|$)`).test(lower)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

const CLAIM_PATTERNS: { re: RegExp; claim: (m: RegExpMatchArray) => string }[] = [
  { re: /gas\s*safe(?:\s*registered)?(?:[^0-9]{0,30}?(\d{5,7}))?/i, claim: (m) => m[1] ? `Gas Safe registered (No. ${m[1]})` : 'Gas Safe registered' },
  { re: /\bniceic\b/i, claim: () => 'NICEIC approved' },
  { re: /\bnapit\b/i, claim: () => 'NAPIT registered' },
  { re: /\bcheckatrade\b/i, claim: () => 'On Checkatrade' },
  { re: /\btrustatrader\b/i, claim: () => 'On TrustATrader' },
  { re: /which\?\s*trusted\s*trader/i, claim: () => 'Which? Trusted Trader' },
  { re: /\btrustmark\b/i, claim: () => 'TrustMark registered' },
  { re: /\b(fmb|federation of master builders)\b/i, claim: () => 'Federation of Master Builders member' },
  { re: /\bciphe\b/i, claim: () => 'CIPHE member' },
  { re: /\boftec\b/i, claim: () => 'OFTEC registered' },
  { re: /fully\s+insured/i, claim: () => 'Fully insured' },
  { re: /public\s+liability/i, claim: () => 'Public liability insurance' },
  { re: /\bdbs[- ]checked\b/i, claim: () => 'DBS checked' },
  { re: /ofsted[^.]{0,20}?(outstanding|good|requires improvement)/i, claim: (m) => `Ofsted rated ${m[1].toLowerCase()}` },
  { re: /\bcqc\b/i, claim: () => 'CQC registered' },
  { re: /\bgdc\b/i, claim: () => 'GDC registered' },
  { re: /\bsra\b/i, claim: () => 'SRA regulated' },
  { re: /\bpropertymark\b/i, claim: () => 'Propertymark member' },
  { re: /\b(?:est\.?|established|since|founded)\s*(?:in\s*)?((?:19|20)\d{2})\b/i, claim: (m) => `Established ${m[1]}` },
  { re: /\b(\d{2,3})\+?\s*years(?:'|’)?\s*(?:of\s*)?(?:experience|in the trade|in business)/i, claim: (m) => `${m[1]}+ years' experience` },
  { re: /family[- ]run/i, claim: () => 'Family-run business' },
  { re: /free\s+(?:quotes?|quotations?|estimates?)/i, claim: () => 'Free quotes' },
  { re: /same[- ]day/i, claim: () => 'Same-day service' },
  { re: /\b(?:24\/7|24\s*hours?|emergency\s*call[- ]?outs?)\b/i, claim: () => 'Emergency call-outs' },
];

function sentenceAround(text: string, index: number, max = 200): string {
  // Sentence ends at . ! or ? followed by whitespace and a capital letter, so "No. 512345" and "Ltd. We" survive.
  const boundary = /[.!?](?=\s+[A-Z])/g;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(boundary)) {
    if (m.index! < index) start = m.index! + 1;
    else { end = m.index! + 1; break; }
  }
  return text.slice(Math.max(start, index - 70), Math.min(end, index + 130)).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function extractClaims(text: string, url: string | null): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  const clean = text.replace(/\s+/g, ' ');
  for (const { re, claim } of CLAIM_PATTERNS) {
    const m = clean.match(re);
    if (!m || m.index === undefined) continue;
    const c = claim(m);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push({ claim: c, source: 'website', url, quote: sentenceAround(clean, m.index) });
  }
  return out;
}

const REVIEW_THEMES: { re: RegExp; claim: string }[] = [
  { re: /same[- ]day/i, claim: 'Customers mention same-day service' },
  { re: /\bon time\b|punctual/i, claim: 'Customers mention being on time' },
  { re: /\b(tidy|clean(ed)? up)\b/i, claim: 'Customers mention tidy work' },
  { re: /\b(price|value|reasonabl|afford)/i, claim: 'Customers mention fair prices' },
  { re: /\b(friendly|polite|lovely|kind)\b/i, claim: 'Customers mention friendly service' },
  { re: /\brecommend/i, claim: 'Customers recommend them' },
  { re: /\b(professional|expert|knowledgeable)\b/i, claim: 'Customers mention professionalism' },
];

export function claimsFromReviews(reviews: { text: string; author: string | null }[]): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const r of reviews) {
    for (const t of REVIEW_THEMES) {
      if (seen.has(t.claim)) continue;
      const m = r.text.match(t.re);
      if (!m || m.index === undefined) continue;
      seen.add(t.claim);
      out.push({ claim: t.claim, source: 'review', quote: sentenceAround(r.text, m.index), author: r.author });
    }
  }
  return out;
}

const TONE_WORDS = ['friendly', 'professional', 'reliable', 'quick', 'fast', 'clean', 'tidy', 'honest', 'fair', 'great value', 'cheap', 'expert', 'knowledgeable', 'punctual', 'on time', 'patient', 'welcoming', 'relaxed', 'modern', 'traditional', 'luxury', 'family', 'local', 'recommend'];

export function toneHints(reviews: { text: string }[], max = 8): string[] {
  const counts = new Map<string, number>();
  const blob = reviews.map((r) => r.text.toLowerCase()).join(' ');
  for (const w of TONE_WORDS) {
    const n = (blob.match(new RegExp(`\\b${w.replace(' ', '\\s+')}`, 'g')) ?? []).length;
    if (n) counts.set(w, n);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}
