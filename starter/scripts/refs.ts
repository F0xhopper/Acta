// Screenshot reference sites you found while browsing galleries, so you can look at them with Read.
// Run: pnpm refs https://example.com [https://another.com ...]  ->  acta/research/refs/<host>-{mobile,desktop}.png
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

async function main() {
  const urls = process.argv.slice(2).filter((u) => /^https?:\/\//.test(u)).slice(0, 8);
  if (!urls.length) { console.error('Give one or more https:// addresses (up to 8).'); process.exit(1); }
  mkdirSync('acta/research/refs', { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const url of urls) {
      const host = new URL(url).host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '');
      for (const [name, opts] of [['mobile', { ...devices['iPhone 13'] }], ['desktop', { viewport: { width: 1440, height: 900 } }]] as const) {
        const ctx = await browser.newContext({ ...opts, locale: 'en-GB' });
        const page = await ctx.newPage();
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2500);
          const file = `acta/research/refs/${host}-${name}.png`;
          await page.screenshot({ path: file, fullPage: false });
          console.log(file);
        } catch (e) { console.log(`could not capture ${url} (${name}): ${(e as Error).message.split('\n')[0]}`); }
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
}
void main();
