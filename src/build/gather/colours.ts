import sharp from 'sharp';

export type Hex = string;

/** Any CSS colour string we're likely to meet to #rrggbb. Transparent or unparseable gives null. */
export function toHex(input: string | null | undefined): Hex | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return m[2] && parseInt(m[2], 16) < 128 ? null : `#${m[1]}`;
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) return null;
    }
    return rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const named: Record<string, Hex> = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', navy: '#000080', orange: '#ffa500', yellow: '#ffff00', purple: '#800080', pink: '#ffc0cb', grey: '#808080', gray: '#808080', teal: '#008080' };
  return named[s] ?? null;
}

export const rgbToHex = (r: number, g: number, b: number): Hex =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export function hexToRgb(hex: Hex): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function hexToHsl(hex: Hex): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export const hueDistance = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
export const isNearWhite = (hex: Hex) => hexToRgb(hex).every((v) => v > 240);
export const isNearBlack = (hex: Hex) => hexToRgb(hex).every((v) => v < 20);
export const isBrandLike = (hex: Hex) => { const { s, l } = hexToHsl(hex); return s > 0.25 && l > 0.08 && l < 0.92; };

export function distinct(a: Hex, b: Hex): boolean {
  const ha = hexToHsl(a), hb = hexToHsl(b);
  if (ha.s < 0.15 && hb.s < 0.15) return Math.abs(ha.l - hb.l) > 0.25;
  return hueDistance(ha.h, hb.h) > 30 || Math.abs(ha.l - hb.l) > 0.25;
}

/** Colour words for search queries and notes. */
export function colourWord(hex: Hex | null): string | null {
  if (!hex) return null;
  const { h, s, l } = hexToHsl(hex);
  if (l > 0.93) return 'white';
  if (l < 0.12) return 'black';
  if (s < 0.15) return 'grey';
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 65) return 'yellow';
  if (h < 160) return 'green';
  if (h < 195) return 'teal';
  if (h < 250) return l < 0.36 ? 'navy' : 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

/** Dominant colours of an image, ignoring transparent, near-white and near-black pixels. */
export async function dominantColours(buffer: Buffer, top = 5): Promise<{ hex: Hex; share: number }[]> {
  const { data, info } = await sharp(buffer).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  let counted = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3] ?? 255;
    if (a < 128) continue;
    if (r > 240 && g > 240 && b > 240) continue;
    if (r < 20 && g < 20 && b < 20) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += r; e.g += g; e.b += b; e.n++;
    buckets.set(key, e);
    counted++;
  }
  if (!counted) return [];
  return [...buckets.values()].sort((x, y) => y.n - x.n).slice(0, top)
    .map((e) => ({ hex: rgbToHex(e.r / e.n, e.g / e.n, e.b / e.n), share: e.n / counted }));
}

export interface ColourInputs {
  headerBg?: Hex | null;
  buttonBg?: Hex | null;
  buttonText?: Hex | null;
  navLink?: Hex | null;
  h1?: Hex | null;
  bodyText?: Hex | null;
  bodyBg?: Hex | null;
  cssVars?: Record<string, Hex>;     // name -> hex, already filtered to brand-ish names
  logo?: Hex[];                       // dominant colours of the logo, most common first
  photos?: Hex[];                     // dominant colours across the top photos
}

export interface Palette {
  primary: Hex | null; secondary: Hex | null; accent: Hex | null; neutral: Hex | null; background: Hex | null;
  confidence: 'high' | 'medium' | 'low'; notes: string[];
}

/** Decide a palette from everything the crawl saw. Explains itself in notes. */
export function voteColours(i: ColourInputs): Palette {
  const notes: string[] = [];
  const siteCands: { hex: Hex; from: string }[] = [];
  if (i.headerBg && isBrandLike(i.headerBg)) siteCands.push({ hex: i.headerBg, from: 'header background' });
  if (i.buttonBg && isBrandLike(i.buttonBg)) siteCands.push({ hex: i.buttonBg, from: 'button background' });
  for (const [name, hex] of Object.entries(i.cssVars ?? {})) if (isBrandLike(hex)) siteCands.push({ hex, from: `CSS variable ${name}` });
  if (i.navLink && isBrandLike(i.navLink)) siteCands.push({ hex: i.navLink, from: 'nav link colour' });
  if (i.h1 && isBrandLike(i.h1)) siteCands.push({ hex: i.h1, from: 'heading colour' });
  const logoCands = (i.logo ?? []).filter(isBrandLike);
  const photoCands = (i.photos ?? []).filter(isBrandLike);

  let primary: Hex | null = null; let primaryFrom = '';
  let confidence: Palette['confidence'] = 'low';
  if (siteCands.length) {
    primary = siteCands[0].hex; primaryFrom = siteCands[0].from;
    const agrees = logoCands.some((c) => hueDistance(hexToHsl(c).h, hexToHsl(primary!).h) <= 25);
    confidence = agrees ? 'high' : 'medium';
    notes.push(`primary ${primary} from ${primaryFrom}${agrees ? ', confirmed by logo' : ''}`);
  } else if (logoCands.length) {
    primary = logoCands[0]; primaryFrom = 'logo';
    confidence = 'medium';
    notes.push(`primary ${primary} from the logo`);
  } else if (photoCands.length) {
    notes.push(`no brand colour on the site or logo; photos lean ${colourWord(photoCands[0])} (${photoCands[0]}), left for the designer`);
  } else {
    notes.push('no brand colour found; the designer chooses');
  }

  const pool = [...siteCands.map((c) => c.hex), ...logoCands, ...photoCands];
  const pick = (exclude: (Hex | null)[]) => pool.find((h) => exclude.every((e) => !e || distinct(h, e))) ?? null;
  const secondary = primary ? pick([primary]) : null;
  if (secondary) notes.push(`secondary ${secondary}`);
  let accent: Hex | null = null;
  const linkish = [i.navLink, i.buttonBg].map((x) => x ?? null).find((h) => h && isBrandLike(h) && (!primary || distinct(h, primary)) && (!secondary || distinct(h, secondary))) ?? null;
  if (linkish) { accent = linkish; notes.push(`accent ${accent} from links or buttons`); }
  else { accent = pick([primary, secondary]); if (accent) notes.push(`accent ${accent}`); }
  const neutral = i.bodyText && !isNearWhite(i.bodyText) ? i.bodyText : '#1f2937';
  const background = i.bodyBg && (isNearWhite(i.bodyBg) || hexToHsl(i.bodyBg).l > 0.85 || hexToHsl(i.bodyBg).l < 0.2) ? i.bodyBg : '#ffffff';
  if (i.bodyBg && background === i.bodyBg && !isNearWhite(i.bodyBg)) notes.push(`background ${background} from the body`);
  return { primary, secondary, accent, neutral, background, confidence, notes };
}
