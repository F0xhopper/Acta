/**
 * Managed by Acta. Do not edit.
 *
 * The site's icons and link preview, generated at build time from the brand:
 *  - icon (browser tab), apple-icon (iPhone home screen): the logo when there is a square-ish one, otherwise the
 *    business's initial in the heading font on the primary colour.
 *  - opengraph image (what WhatsApp, iMessage, Facebook show when the link is shared): the best photo, the name,
 *    the rating and the area. This is the first thing a business owner sees when a preview link is sent.
 * Used by src/app/icon.tsx, apple-icon.tsx, opengraph-image.tsx and manifest.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import site from '@/content/site';
import { theme } from '@/theme';

type Colors = typeof theme.colors & { onPrimary?: string };
const c = theme.colors as Colors;
const onPrimary = c.onPrimary ?? c.text;

const publicFile = (p: string) => join(process.cwd(), 'public', p.replace(/^\//, ''));
const mime = (p: string) => (/\.png$/i.test(p) ? 'image/png' : /\.svg$/i.test(p) ? 'image/svg+xml' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
function dataUri(p: string): string | null {
  const f = publicFile(p);
  if (!existsSync(f)) return null;
  return `data:${mime(p)};base64,${readFileSync(f).toString('base64')}`;
}

/** The business's initial: first letter of the first word that isn't "The". */
export function initialOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const w = words.find((x) => x.toLowerCase() !== 'the') ?? words[0] ?? 'A';
  return w.charAt(0).toUpperCase();
}

/** The heading font as TTF for these characters, from Google Fonts. Falls back to the default font offline. */
async function headingFont(text: string): Promise<{ name: string; data: ArrayBuffer; weight: 700; style: 'normal' }[]> {
  const family = theme.fonts.heading;
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@700&text=${encodeURIComponent(text)}`, { headers: { 'user-agent': 'curl/8' } })).text();
    const url = css.match(/url\((https:[^)]+)\)/)?.[1];
    if (!url) return [];
    const data = await (await fetch(url)).arrayBuffer();
    return [{ name: family, data, weight: 700, style: 'normal' }];
  } catch {
    return [];
  }
}

/** A logo is usable as an icon when it exists and is roughly square. */
function squareLogo(): string | null {
  const logo = site.logo?.path;
  if (!logo || /\.svg$/i.test(logo)) return null;
  const f = publicFile(logo);
  if (!existsSync(f)) return null;
  const b = readFileSync(f);
  // PNG width and height live at bytes 16-23.
  if (b.slice(1, 4).toString() === 'PNG') {
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (w / h < 0.8 || w / h > 1.25) return null;
  }
  return dataUri(logo);
}

export async function iconImage(size: number): Promise<ImageResponse> {
  const logo = squareLogo();
  const letter = initialOf(site.business.name);
  const fonts = logo ? [] : await headingFont(letter);
  return new ImageResponse(
    logo ? (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.neutral, borderRadius: size * 0.18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={size * 0.82} height={size * 0.82} style={{ objectFit: 'contain' }} alt="" />
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.primary, color: onPrimary, borderRadius: size * 0.18, fontSize: size * 0.68, fontWeight: 700, fontFamily: fonts[0]?.name, lineHeight: 1, paddingBottom: size * 0.04 }}>
        {letter}
      </div>
    ),
    { width: size, height: size, fonts },
  );
}

export const OG_SIZE = { width: 1200, height: 630 };

export async function ogImage(): Promise<ImageResponse> {
  const b = site.business;
  const photo = site.photos[0] ? dataUri(site.photos[0].path) : null;
  const rating = b.rating && b.review_count ? `Rated ${b.rating} from ${b.review_count} Google reviews` : null;
  const label = `${b.area}, ${b.city}`.toUpperCase();
  // One font for every glyph on the card: fetch the subset covering all of the text, case included.
  const fonts = await headingFont(`${b.name}${label}${rating ?? ''}`);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: c.neutral, color: '#fff', fontFamily: fonts[0]?.name }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo ? <img src={photo} width={1200} height={630} style={{ position: 'absolute', inset: 0, width: 1200, height: 630, objectFit: 'cover' }} alt="" /> : null}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.82) 100%)' }} />
        <div style={{ position: 'absolute', left: 64, right: 64, bottom: 56, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignSelf: 'flex-start', background: c.primary, color: onPrimary, fontSize: 26, fontWeight: 700, padding: '6px 14px', letterSpacing: 1 }}>{label}</div>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, lineHeight: 1.02, fontFamily: fonts[0]?.name }}>{b.name}</div>
          {rating ? <div style={{ display: 'flex', fontSize: 34, color: c.primary }}>{rating}</div> : null}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
