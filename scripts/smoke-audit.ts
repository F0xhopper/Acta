// Offline-ish smoke test of the audit path (no API keys needed): fetch, classify, HTML checks, screenshot.
// Run: pnpm exec tsx scripts/smoke-audit.ts [url ...]
import { fetchHomepage } from '../src/audit/fetch.js';
import { runHtmlChecks } from '../src/audit/html-checks.js';
import { classifyFetch } from '../src/audit/classify.js';
import { closeBrowser, screenshotSite } from '../src/audit/screenshot.js';
import { loadScoring } from '../src/config.js';

async function main() {
  const scoring = loadScoring();
  const urls = process.argv.slice(2).length ? process.argv.slice(2) : ['http://example.com', 'https://expired.badssl.com/', 'http://this-domain-does-not-exist-xyz123.co.uk'];
  for (const url of urls) {
    const f = await fetchHomepage(url);
    const status = classifyFetch({ httpStatus: f.httpStatus, error: f.error, tlsError: f.tlsError, redirectLoop: f.redirectLoop, body: f.body, contentType: f.contentType }, scoring);
    console.log(url, '->', status, { http: f.httpStatus, final: f.finalUrl, redirects: f.redirectCount, ttfb: f.ttfbMs, httpsOk: f.httpsOk, toHttps: f.httpRedirectsToHttps, tls: f.tlsError, err: f.error });
    if (status === 'live') console.log('  checks:', JSON.stringify(runHtmlChecks(f.body, f.headers, f.finalDomain, null, scoring)));
  }
  const s = await screenshotSite('https://example.com', 'smoke-example');
  console.log('screenshot:', s);
  await closeBrowser();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
