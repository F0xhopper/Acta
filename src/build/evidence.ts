import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { chromium, devices } from 'playwright';
import type { FullLead } from '../db/types.js';
import type { GateReport } from './contracts.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function scoreFromGate(report: GateReport | null): number | null {
  const g = report?.gates.find((x) => x.name === 'lighthouse');
  if (!g) return null;
  const text = `${g.value ?? ''} ${(g.details ?? []).join(' ')}`;
  const m = text.match(/perf(?:ormance)?[^0-9]{0,12}(\d{1,3})/i);
  return m ? Number(m[1]) : typeof g.value === 'number' ? g.value : null;
}

async function shotOf(url: string, out: string): Promise<string | null> {
  const b = await chromium.launch({ headless: true });
  try {
    const ctx = await b.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true, locale: 'en-GB' });
    const page = await ctx.newPage();
    try { await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }); } catch { await page.goto(url, { waitUntil: 'load', timeout: 30_000 }); }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: out, fullPage: false });
    return out;
  } catch { return null; } finally { await b.close(); }
}

/** Their site next to the new one on a phone, scores underneath. The picture that does the selling. */
export async function makeEvidence(full: FullLead, afterPng: string | null, previewUrl: string | null, gate: GateReport | null, outPath: string): Promise<string> {
  mkdirSync(dirname(outPath), { recursive: true });
  const W = 1800, H = 1300, PH = 900, PW = Math.round(PH * 390 / 844), Y = 250;
  const leftX = Math.round(W / 4 - PW / 2), rightX = Math.round((3 * W) / 4 - PW / 2);
  const after = afterPng && existsSync(afterPng) ? afterPng : previewUrl ? await shotOf(previewUrl, join(dirname(outPath), 'preview-mobile.png')) : null;
  const before = full.audit?.screenshot_mobile && existsSync(full.audit.screenshot_mobile) ? full.audit.screenshot_mobile : null;
  const beforeScore = full.audit?.lh_perf ?? null;
  const afterScore = scoreFromGate(gate);
  const status = full.audit?.website_status ?? 'none';
  const beforeLabel = status === 'none' ? 'No website' : status === 'live' ? 'Their website today' : `Their website today (${status})`;

  const frame = (x: number) => `<rect x="${x - 14}" y="${Y - 14}" width="${PW + 28}" height="${PH + 28}" rx="44" fill="#111"/>`;
  const card = (x: number, text: string) => `<rect x="${x}" y="${Y}" width="${PW}" height="${PH}" rx="30" fill="#f3f4f6"/><text x="${x + PW / 2}" y="${Y + PH / 2}" text-anchor="middle" font-family="Helvetica, Arial" font-size="34" fill="#6b7280">${esc(text)}</text>`;
  const scoreText = (x: number, s: number | null, label: string) => s === null ? '' : `<text x="${x + PW / 2}" y="${Y + PH + 90}" text-anchor="middle" font-family="Helvetica, Arial" font-size="40" font-weight="700" fill="${s >= 90 ? '#15803d' : s >= 50 ? '#b45309' : '#b91c1c'}">${label} ${s}/100</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <text x="${W / 2}" y="110" text-anchor="middle" font-family="Helvetica, Arial" font-size="56" font-weight="700" fill="#111">${esc(full.lead.name)}</text>
    <text x="${W / 4}" y="200" text-anchor="middle" font-family="Helvetica, Arial" font-size="34" fill="#374151">${esc(beforeLabel)}</text>
    <text x="${(3 * W) / 4}" y="200" text-anchor="middle" font-family="Helvetica, Arial" font-size="34" fill="#374151">With a new site</text>
    ${frame(leftX)}${frame(rightX)}
    ${before ? '' : card(leftX, status === 'none' ? 'Nothing to show' : 'Could not load')}
    ${after ? '' : card(rightX, 'Preview')}
    ${scoreText(leftX, beforeScore, 'Mobile speed')}${scoreText(rightX, afterScore, 'Mobile speed')}
    <text x="${W / 2}" y="${H - 50}" text-anchor="middle" font-family="Helvetica, Arial" font-size="26" fill="#9ca3af">Scores are Google Lighthouse mobile performance</text>
  </svg>`;
  const layers: OverlayOptions[] = [];
  for (const [file, x] of [[before, leftX], [after, rightX]] as const) {
    if (!file) continue;
    const buf = await sharp(file).resize(PW, PH, { fit: 'cover', position: 'top' }).png().toBuffer();
    const mask = Buffer.from(`<svg width="${PW}" height="${PH}"><rect width="${PW}" height="${PH}" rx="30" fill="#fff"/></svg>`);
    const rounded = await sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: rounded, left: x, top: Y });
  }
  await sharp(Buffer.from(svg)).composite(layers).png().toFile(outPath);
  return outPath;
}
