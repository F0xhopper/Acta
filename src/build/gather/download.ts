import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { fetchWithTimeout } from '../../util/http.js';

export interface LogoFile { path: string; format: 'svg' | 'png'; width: number | null; height: number | null; quality: 'svg' | 'raster_ok' | 'raster_low' }

const RASTER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Builders serve resized variants; ask for the original where the URL scheme is known. */
export function originalAssetUrl(url: string): string {
  const wix = url.match(/^(https:\/\/static\.wixstatic\.com\/media\/[^/?]+)\/v1\//);
  if (wix) return wix[1];
  const sq = url.match(/^(https:\/\/images\.squarespace-cdn\.com\/.+?)\?format=.*$/);
  if (sq) return `${sq[1]}?format=2500w`;
  const shop = url.replace(/(_\d+x\d*|_\d*x\d+)(\.(?:jpg|jpeg|png|webp))(\?|$)/i, '$2$3');
  if (/cdn\.shopify\.com/.test(url)) return shop;
  return url;
}

export async function fetchBinary(url: string, timeoutMs = 20000): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs, headers: { accept: 'image/*,*/*;q=0.8', 'user-agent': RASTER_UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return { buf, contentType: res.headers.get('content-type') ?? '' };
  } catch {
    return null;
  }
}

const isSvg = (buf: Buffer, ct: string) => /svg/i.test(ct) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg/i.test(buf.subarray(0, 600).toString('utf8'));

/** Make a flat single-colour background transparent when the corners agree. Leaves anything else alone. */
export async function knockOutFlatBackground(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  if (w < 4 || h < 4) return buf;
  const px = (x: number, y: number) => { const i = (y * w + x) * c; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const [r0, g0, b0, a0] = corners[0];
  if (a0 < 250) return buf; // already transparent
  const same = corners.every(([r, g, b]) => Math.abs(r - r0) < 8 && Math.abs(g - g0) < 8 && Math.abs(b - b0) < 8);
  if (!same) return buf;
  let changed = 0;
  for (let i = 0; i < data.length; i += c) {
    if (Math.abs(data[i] - r0) < 18 && Math.abs(data[i + 1] - g0) < 18 && Math.abs(data[i + 2] - b0) < 18) { data[i + 3] = 0; changed++; }
  }
  // If we'd wipe most of the image it isn't a flat background around a logo, it's the logo.
  if (changed > (w * h) * 0.92) return buf;
  return sharp(data, { raw: { width: w, height: h, channels: c as 4 } }).png().toBuffer();
}

/** Download a logo candidate and normalise it. Returns null if it isn't usable. */
export async function saveLogo(url: string, destBase: string, opts: { allowLarge?: boolean } = {}): Promise<LogoFile | null> {
  const got = (await fetchBinary(originalAssetUrl(url))) ?? (await fetchBinary(url));
  if (!got) return null;
  const { buf, contentType } = got;
  if (isSvg(buf, contentType)) {
    const svg = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
    const path = `${destBase}.svg`;
    writeFileSync(path, svg);
    const wm = svg.match(/width="([\d.]+)/), hm = svg.match(/height="([\d.]+)/);
    return { path, format: 'svg', width: wm ? Math.round(Number(wm[1])) : null, height: hm ? Math.round(Number(hm[1])) : null, quality: 'svg' };
  }
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    // A photo-shaped og:image is not a logo. Header logos can legitimately be large originals.
    if (!opts.allowLarge && meta.width > 900 && meta.height > 450 && !/logo/i.test(url)) return null;
    let png: Buffer = await sharp(buf).resize({ width: 1200, withoutEnlargement: true }).png().toBuffer();
    try { png = await sharp(png).trim({ threshold: 12 }).png().toBuffer(); } catch { /* trim can fail on flat images */ }
    try { png = await knockOutFlatBackground(png); } catch { /* keep opaque */ }
    const out = await sharp(png).png().toBuffer({ resolveWithObject: true });
    const path = `${destBase}.png`;
    writeFileSync(path, out.data);
    return { path, format: 'png', width: out.info.width, height: out.info.height, quality: out.info.width >= 200 ? 'raster_ok' : 'raster_low' };
  } catch {
    return null;
  }
}

/** Download a site photo as JPEG. */
export async function savePhoto(url: string, dest: string): Promise<{ width: number; height: number } | null> {
  const got = (await fetchBinary(originalAssetUrl(url), 30000)) ?? (await fetchBinary(url, 30000));
  if (!got) return null;
  try {
    const meta = await sharp(got.buf).metadata();
    if (!meta.width || meta.width < 600) return null;
    const out = await encodePhotoUnderBudget(got.buf);
    writeFileSync(dest, out.data);
    return { width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

/**
 * A JPEG master for next/image to serve from: 2400px wide at high quality, so a full-width hero stays sharp on a
 * retina desktop. The site never serves this file directly; the images gate measures what a phone is served.
 * Steps down only when a master gets heavy for the repo.
 */
export async function encodePhotoUnderBudget(buf: Buffer, max = 900 * 1024) {
  let out = await sharp(buf).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  for (const [width, quality] of [[2400, 78], [2000, 76], [1800, 74], [1600, 72]] as const) {
    if (out.data.length <= max) break;
    out = await sharp(buf).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  }
  return out;
}

/** Google's four brand colours together mean a review badge, not a logo. */
const GOOGLE = [[66, 133, 244], [234, 67, 53], [251, 188, 5], [52, 168, 83]] as const;
export async function looksLikeGoogleBadge(buf: Buffer): Promise<boolean> {
  try {
    const { data, info } = await sharp(buf).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const counts = [0, 0, 0, 0];
    let opaque = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;
      opaque++;
      GOOGLE.forEach(([r, g, b], k) => { if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 90) counts[k]++; });
    }
    if (!opaque) return false;
    return counts.filter((c) => c / opaque >= 0.02).length >= 3;
  } catch { return false; }
}
