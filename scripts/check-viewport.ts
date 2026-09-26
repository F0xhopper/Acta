// Show what viewport meta a real phone browser sees on a URL. Run: pnpm exec tsx scripts/check-viewport.ts <url>
import { chromium, devices } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'load', timeout: 30000 });
await p.waitForTimeout(1500);
console.log(await p.evaluate(() => [...document.querySelectorAll('meta[name=viewport]')].map((m) => m.outerHTML)));
console.log('innerWidth', await p.evaluate(() => window.innerWidth), 'scrollWidth', await p.evaluate(() => document.documentElement.scrollWidth));
await b.close();
