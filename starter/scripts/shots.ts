// Screenshots of / at phone, tablet and desktop into acta/qa/. Run: pnpm shots [--url http://...]
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { startBuilt } from './lib/server';

async function main() {
  const urlArg = process.argv.indexOf('--url');
  const given = urlArg >= 0 ? process.argv[urlArg + 1] : null;
  const server = given ? null : await startBuilt({ log: (s) => console.log(s) });
  const base = given ?? server!.url;
  mkdirSync('acta/qa', { recursive: true });
  const browser = await chromium.launch();
  try {
    const shots: [string, Record<string, unknown>, boolean][] = [
      ['mobile', { ...devices['iPhone 13'] }, true],
      ['tablet', { ...devices['iPad (gen 7)'] }, true],
      ['desktop', { viewport: { width: 1440, height: 900 } }, true],
    ];
    for (const [name, ctxOpts, fullPage] of shots) {
      const ctx = await browser.newContext({ ...ctxOpts, locale: 'en-GB' });
      const page = await ctx.newPage();
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `acta/qa/${name}.png`, fullPage });
      if (name === 'mobile') await page.screenshot({ path: 'acta/qa/hero-mobile.png', fullPage: false });
      await ctx.close();
      console.log(`acta/qa/${name}.png`);
    }
  } finally {
    await browser.close();
    server?.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
