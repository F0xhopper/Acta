import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser } from 'playwright';
import { SCREENSHOT_DIR } from '../config.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = null;
}

export interface ShotResult { mobile: string | null; desktop: string | null; error: string | null }

async function shoot(url: string, file: string, contextOpts: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const b = await getBrowser();
  const ctx = await b.newContext({ ...contextOpts, ignoreHTTPSErrors: true, locale: 'en-GB' });
  const page = await ctx.newPage();
  try {
    try { await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }); }
    catch { await page.goto(url, { waitUntil: 'load', timeout: timeoutMs }); }
    await page.waitForTimeout(800);
    await page.screenshot({ path: file, fullPage: false });
  } finally {
    await ctx.close();
  }
}

export async function screenshotSite(url: string, slug: string, timeoutMs = 20000): Promise<ShotResult> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const mobile = join(SCREENSHOT_DIR, `${slug}-mobile.png`);
  const desktop = join(SCREENSHOT_DIR, `${slug}-desktop.png`);
  const out: ShotResult = { mobile: null, desktop: null, error: null };
  try {
    await shoot(url, mobile, { ...devices['iPhone 13'] }, timeoutMs);
    out.mobile = mobile;
  } catch (e) { out.error = `mobile: ${(e as Error).message.slice(0, 200)}`; }
  try {
    await shoot(url, desktop, { viewport: { width: 1280, height: 800 } }, timeoutMs);
    out.desktop = desktop;
  } catch (e) { out.error = `${out.error ? out.error + '; ' : ''}desktop: ${(e as Error).message.slice(0, 200)}`; }
  return out;
}
