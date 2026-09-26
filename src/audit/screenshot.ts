import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser, type Page } from 'playwright';
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

/** What a real phone browser saw: screenshots plus the rendered DOM for a second-opinion audit. */
export interface RenderResult {
  mobile: string | null;
  desktop: string | null;
  html: string | null;
  title: string | null;
  text: string;
  status: number | null;
  finalUrl: string | null;
  error: string | null;
}

async function load(page: Page, url: string, timeoutMs: number) {
  try { return await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }); }
  catch { return await page.goto(url, { waitUntil: 'load', timeout: timeoutMs }); }
}

export async function renderSite(url: string, slug: string, timeoutMs = 20000): Promise<RenderResult> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const mobile = join(SCREENSHOT_DIR, `${slug}-mobile.png`);
  const desktop = join(SCREENSHOT_DIR, `${slug}-desktop.png`);
  const out: RenderResult = { mobile: null, desktop: null, html: null, title: null, text: '', status: null, finalUrl: null, error: null };
  const b = await getBrowser();

  const ctx = await b.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true, locale: 'en-GB' });
  try {
    const page = await ctx.newPage();
    const resp = await load(page, url, timeoutMs);
    // Give bot challenges and client-side builders a moment to finish.
    await page.waitForTimeout(1500);
    out.status = resp?.status() ?? null;
    out.finalUrl = page.url();
    out.html = await page.content();
    out.title = await page.title();
    out.text = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 5000));
    await page.screenshot({ path: mobile, fullPage: false });
    out.mobile = mobile;
  } catch (e) {
    out.error = `render: ${(e as Error).message.split('\n')[0].slice(0, 200)}`;
  } finally {
    await ctx.close();
  }

  if (out.mobile) {
    const dctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, locale: 'en-GB' });
    try {
      const page = await dctx.newPage();
      await load(page, out.finalUrl ?? url, timeoutMs);
      await page.waitForTimeout(800);
      await page.screenshot({ path: desktop, fullPage: false });
      out.desktop = desktop;
    } catch (e) {
      out.error = `desktop: ${(e as Error).message.split('\n')[0].slice(0, 200)}`;
    } finally {
      await dctx.close();
    }
  }
  return out;
}

/** Back-compat for the smoke script. */
export const screenshotSite = renderSite;

const BLOCKED = /just a moment|attention required|access denied|verify you are human|checking your browser|request blocked|are you a robot|enable javascript and cookies/i;

/** Did a real person get a usable page? */
export function renderLooksReal(r: RenderResult | null): boolean {
  if (!r || !r.html || r.error?.startsWith('render:')) return false;
  if (r.status === 404 || r.status === 410) return false;
  if (BLOCKED.test(`${r.title ?? ''} ${r.text.slice(0, 400)}`)) return false;
  return r.text.length >= 200;
}
