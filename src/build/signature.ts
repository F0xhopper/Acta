/**
 * A site's design signature: the few choices that make two sites look alike even when the photos differ.
 * Read from the files the designer actually wrote (src/theme.ts and the Signature block of acta/brief.md), so it
 * can't drift from the site. Used by the previous-sites memory and by the uniqueness check.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colourWord, hexToHsl, hexToRgb } from './gather/colours.js';

export const HERO_COMPOSITIONS = ['photo-full-bleed-text-over', 'photo-top-text-below', 'split-left-photo', 'split-right-photo', 'text-first-photo-below', 'type-only'] as const;
export type HeroComposition = (typeof HERO_COMPOSITIONS)[number];

export interface Signature {
  headingFont: string | null;
  bodyFont: string | null;
  primary: string | null;
  background: string | null;
  /** From the theme background: dark ground or light ground. */
  mode: 'light' | 'dark' | null;
  /** The primary's hue in twelve buckets, or null when the primary is a neutral. */
  hue: number | null;
  hero: HeroComposition | null;
  direction: string | null;
  move: string | null;
  concept: string | null;
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const first = (s: string, re: RegExp) => s.match(re)?.[1]?.replace(/\*\*/g, '').trim() || null;

/** Relative luminance (sRGB), 0 black to 1 white. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pure: the signature from the theme source, the brief and the concepts file. */
export function parseSignature(theme: string, brief: string, concepts: string): Signature {
  const fonts = theme.match(/fonts:\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const colours = theme.match(/colors:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? theme;
  const primary = first(colours, /\bprimary:\s*'(#[0-9a-fA-F]{6})'/)?.toLowerCase() ?? null;
  const background = first(colours, /\bbackground:\s*'(#[0-9a-fA-F]{6})'/)?.toLowerCase() ?? null;
  const hsl = primary ? hexToHsl(primary) : null;
  const heroRaw = first(brief, /Hero composition:\s*`?([a-z-]+)/i)?.toLowerCase() ?? null;
  return {
    headingFont: first(fonts, /\bheading:\s*'([^']+)'/),
    bodyFont: first(fonts, /\bbody:\s*'([^']+)'/),
    primary,
    background,
    mode: background ? (luminance(background) < 0.4 ? 'dark' : 'light') : null,
    // Slate, charcoal and off-black primaries are neutrals: only a saturated primary carries a hue.
    hue: hsl && hsl.s >= 0.3 && hsl.l > 0.08 && hsl.l < 0.92 ? Math.floor(((hsl.h % 360) + 360) % 360 / 30) : null,
    hero: (HERO_COMPOSITIONS as readonly string[]).includes(heroRaw ?? '') ? (heroRaw as HeroComposition) : null,
    direction: first(brief, /^[-*]?\s*Direction:\s*(.+)$/m) ?? first(brief, /^##\s*(?:\d+\.\s*)?Direction\s*\n+\s*\**([^\n*]+)/m),
    move: first(brief, /^[-*]?\s*One move:\s*(.+)$/m),
    concept: first(concepts, /^##\s*Chosen\s*\n+([^\n]+)/m),
  };
}

export function readSignature(repoDir: string): Signature {
  return parseSignature(read(join(repoDir, 'src/theme.ts')), read(join(repoDir, 'acta/brief.md')), read(join(repoDir, 'acta/concepts.md')));
}

/** A line a designer can read: "Archivo over Public Sans, light ground, navy primary, split-left-photo hero". */
export function describeSignature(s: Signature): string {
  const parts = [
    s.headingFont ? `${s.headingFont}${s.bodyFont && s.bodyFont !== s.headingFont ? ` over ${s.bodyFont}` : ''}` : null,
    s.mode ? `${s.mode} ground` : null,
    s.primary ? `${s.hue === null ? 'neutral' : colourWord(s.primary) ?? s.primary} primary` : null,
    s.hero ? `${s.hero} hero` : null,
  ].filter(Boolean);
  return parts.join(', ') || 'unknown';
}

export const SAMENESS_LIMIT = 3;

/** How much two signatures share, with the reasons in words. At SAMENESS_LIMIT or more the sites look like siblings. */
export function sameness(a: Signature, b: Signature): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (a.headingFont && b.headingFont && a.headingFont.toLowerCase() === b.headingFont.toLowerCase()) { score += 2; reasons.push(`the same heading family (${a.headingFont})`); }
  if (a.mode && a.mode === b.mode && a.hue === b.hue && (a.hue !== null || (a.primary && b.primary))) { score += 1; reasons.push(`the same ${a.mode} ground with a ${a.hue === null ? 'neutral' : colourWord(a.primary!) ?? ''} primary`); }
  if (a.hero && a.hero === b.hero) { score += 1; reasons.push(`the same hero composition (${a.hero})`); }
  if (a.bodyFont && b.bodyFont && a.bodyFont.toLowerCase() === b.bodyFont.toLowerCase()) { score += 0.5; reasons.push(`the same body family (${a.bodyFont})`); }
  return { score, reasons };
}
