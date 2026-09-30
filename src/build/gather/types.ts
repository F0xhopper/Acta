/** What one crawled page gives us. Built by the browser crawl, or from static HTML as a fallback (styles then null). */
export interface PageImage {
  src: string;
  alt: string | null;
  title: string | null;
  className: string | null;
  width: number;   // natural width, 0 when unknown
  height: number;
  inHeader: boolean;
  nearText: string | null;
}

export interface PageIcon { rel: string; href: string; sizes: string | null }

export interface PageStyles {
  header: { bg: string | null; color: string | null };
  navLink: { color: string | null };
  button: { bg: string | null; color: string | null };
  h1: { fontFamily: string | null; color: string | null };
  body: { fontFamily: string | null; color: string | null; bg: string | null };
}

export interface PageData {
  url: string;
  html: string;
  text: string;
  styles: PageStyles | null;
  images: PageImage[];
  icons: PageIcon[];
  ogImage: string | null;
  socialLinks: string[];
  emails: string[];
  jsonLd: string[];
  fontLinks: string[];
  headings: string[];
  navTexts: string[];
  cssVars: Record<string, string>;
}

export const EMPTY_STYLES: PageStyles = {
  header: { bg: null, color: null }, navLink: { color: null }, button: { bg: null, color: null },
  h1: { fontFamily: null, color: null }, body: { fontFamily: null, color: null, bg: null },
};

/** Supplier, accreditation and platform badges that are never the business's own logo. */
export const BADGE_WORDS = [
  'gas safe', 'gassafe', 'niceic', 'napit', 'checkatrade', 'trustatrader', 'which', 'trustmark', 'worcester', 'vaillant', 'baxi', 'ideal', 'glow-worm', 'glowworm',
  'viessmann', 'fmb', 'ciphe', 'oftec', 'visa', 'mastercard', 'amex', 'paypal', 'stripe', 'facebook', 'instagram', 'google', 'yell', 'tripadvisor', 'booksy',
  'fresha', 'treatwell', 'rated people', 'ratedpeople', 'mybuilder', 'bark', 'ofsted', 'cqc', 'gdc', 'sra', 'propertymark', 'rightmove', 'zoopla', 'onthemarket',
  'tpo', 'arla', 'naea', 'klarna', 'apple pay', 'trustpilot', 'reviews.io', 'whatsapp', 'tiktok', 'youtube', 'linkedin', 'twitter',
];

export function looksLikeBadge(...fields: (string | null | undefined)[]): boolean {
  const blob = fields.filter(Boolean).join(' ').toLowerCase().replace(/[-_.]+/g, ' ');
  if (!blob) return false;
  return BADGE_WORDS.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(blob));
}
