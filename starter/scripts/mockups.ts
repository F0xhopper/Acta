// Screenshots each concept mock-up (acta/concepts/concept-<n>.html) on a phone and a desktop, so concepts are
// judged as pictures, not prose. Run: pnpm mockups  ->  acta/concepts/concept-<n>-{mobile,desktop}.png
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

async function main() {
  const dir = 'acta/concepts';
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^concept-\d+\.html$/.test(f)).sort() : [];
  if (!files.length) { console.error('No acta/concepts/concept-<n>.html files to screenshot.'); process.exit(1); }
  const browser = await chromium.launch();
  try {
    for (const [device, viewport, scale] of [['mobile', { width: 390, height: 844 }, 2], ['desktop', { width: 1440, height: 900 }, 1]] as const) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: 'en-GB', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      for (const f of files) {
        const out = `${dir}/${f.replace('.html', `-${device}.png`)}`;
        try {
          await page.goto(`file://${resolve(dir, f)}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => undefined);
          await page.waitForTimeout(400);
          await page.screenshot({ path: out, fullPage: false });
          console.log(out);
        } catch (e) { console.log(`could not capture ${f} (${device}): ${(e as Error).message.split('\n')[0]}`); }
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
