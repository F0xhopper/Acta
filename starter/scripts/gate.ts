// The gates. Builds, starts the site, checks it, writes acta/qa/gate.json, exits 1 on any failure.
// Run: pnpm gate            full, including Lighthouse
//      pnpm gate:fast       skips Lighthouse while iterating
//      pnpm gate --ci       same gates, flags the report as CI
//      pnpm gate --url URL  check a running site instead of building
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { BrandSchema, FactsSchema, GateReportSchema, type GateReport } from '../src/kit/contracts';
import { contrastRatio } from '../src/kit/contrast';
import { unbackedClaims } from '../src/kit/claims';
import site from '../src/content/site';
import { theme } from '../src/theme';
import { startBuilt } from './lib/server';

type Gate = GateReport['gates'][number];
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const OUT = opt('--out') ?? 'acta/qa/gate.json';
const log = (s: string) => console.log(`gate: ${s}`);

interface Page { path: string; status: number; html: string; text: string; headers: Headers; links: string[] }

/** What this kind of site must contain, written by the pipeline from config/site-types.yaml. */
interface SiteType { name: string; pages: { route: string; purpose: string }[]; features: string[]; home: { section: string; intent: string }[] }
const siteType: SiteType | null = existsSync('acta/site-type.json') ? JSON.parse(readFileSync('acta/site-type.json', 'utf8')) : null;
const requiredRoutes = () => (siteType?.pages ?? []).map((p) => p.route).filter((r) => !r.includes('['));

async function pagesGate(base: string, pages: Map<string, Page>): Promise<Gate> {
  if (!siteType) return { name: 'pages', pass: true, value: 'skipped (no acta/site-type.json)' };
  const details: string[] = [];
  for (const r of requiredRoutes()) {
    const res = await fetch(base + r, { redirect: 'manual' });
    if (res.status !== 200) details.push(`${r} returns ${res.status}; a ${siteType.name} site needs it`);
    else if (!pages.has(r)) details.push(`${r} exists but nothing links to it from the site`);
  }
  return { name: 'pages', pass: details.length === 0, value: `${siteType.name}: ${requiredRoutes().join(' ')}`, details };
}

function mapGate(pages: Map<string, Page>): Gate {
  const wants = !siteType || siteType.features.includes('map');
  if (!wants) return { name: 'map', pass: true, value: 'not required for this site type' };
  if (!site.business.address) return { name: 'map', pass: true, value: 'skipped (no address)' };
  const withMap = [...pages.values()].filter((p) => p.html.includes('data-acta-map')).map((p) => p.path);
  const details = withMap.length ? [] : ['no page uses <MapEmbed> from src/kit/map (Find us needs a map)'];
  return { name: 'map', pass: details.length === 0, value: withMap.length ? `on ${withMap.join(', ')}` : 'missing', details };
}

/** Photos the plan marks "drop" must appear nowhere: not in any page, not in site.ts. */
function droppedPhotosGate(pages: Map<string, Page>): Gate {
  if (!existsSync('acta/plan.md')) return { name: 'dropped-photos', pass: true, value: 'skipped (no plan)' };
  const dropped = new Set<string>();
  for (const line of readFileSync('acta/plan.md', 'utf8').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim().toLowerCase());
    const file = cells.find((c) => /[\w-]+\.(jpe?g|png|webp)/.test(c))?.match(/[\w-]+\.(jpe?g|png|webp)/)?.[0];
    if (file && cells.some((c) => /^\**drop\**$/.test(c) || /^drop\b/.test(c))) dropped.add(file);
  }
  if (!dropped.size) return { name: 'dropped-photos', pass: true, value: 'none dropped' };
  const details: string[] = [];
  const siteSrc = readFileSync('src/content/site.ts', 'utf8').toLowerCase();
  for (const f of dropped) {
    if (siteSrc.includes(f)) details.push(`${f} is marked drop in the plan but listed in site.ts`);
    for (const p of pages.values()) if (p.html.toLowerCase().includes(encodeURIComponent(f).toLowerCase()) || p.html.toLowerCase().includes(f)) details.push(`${f} is marked drop but used on ${p.path}`);
  }
  return { name: 'dropped-photos', pass: details.length === 0, value: `${dropped.size} dropped`, details };
}

/** Brand icons and the link preview exist and are images; the Next.js default favicon is gone. */
async function iconsGate(base: string, pages: Map<string, Page>): Promise<Gate> {
  const home = pages.get('/');
  if (!home) return { name: 'icons', pass: false, details: ['no home page'] };
  const $ = cheerio.load(home.html);
  const details: string[] = [];
  const check = async (what: string, href: string | undefined) => {
    if (!href) { details.push(`${what} missing from <head>`); return; }
    // Absolute URLs point at the production origin (metadataBase); test the same path on the server under test.
    const u = new URL(href, base);
    const res = await fetch(new URL(u.pathname + u.search, base));
    const type = res.headers.get('content-type') ?? '';
    if (res.status !== 200) details.push(`${what} ${href} returns ${res.status}`);
    else if (!/image|json|manifest/.test(type)) details.push(`${what} ${href} is ${type}, not an image`);
  };
  await check('icon', $('link[rel="icon"]').not('[href$="favicon.ico"]').first().attr('href'));
  await check('apple-touch-icon', $('link[rel="apple-touch-icon"]').first().attr('href'));
  await check('og:image', $('meta[property="og:image"]').first().attr('content'));
  await check('manifest', $('link[rel="manifest"]').first().attr('href'));
  const ico = 'src/app/favicon.ico';
  if (existsSync(ico) && execSync(`md5 -q ${ico} 2>/dev/null || md5sum ${ico} | cut -d' ' -f1`).toString().trim() === 'c30c7d42707a47a3f4591831641e50dc') details.push('src/app/favicon.ico is the Next.js default: delete it');
  return { name: 'icons', pass: details.length === 0, value: details.length ? 'incomplete' : 'icon, apple icon, link preview, manifest', details };
}

/** Three concepts, scored, one chosen with a reason, before the brief. */
function conceptsGate(): Gate {
  if (!siteType) return { name: 'concepts', pass: true, value: 'skipped (no acta/site-type.json)' };
  if (!existsSync('acta/concepts.md')) return { name: 'concepts', pass: false, value: 'missing', details: ['acta/concepts.md does not exist: run the concepts phase'] };
  const c = readFileSync('acta/concepts.md', 'utf8');
  const details: string[] = [];
  const count = (c.match(/^##\s+(?!Scores|Chosen)/gim) ?? []).length;
  if (count < 3) details.push(`${count} concepts, needs 3`);
  if (!/^##\s*Scores/im.test(c)) details.push('no ## Scores section');
  if (!/^##\s*Chosen/im.test(c)) details.push('no ## Chosen section');
  return { name: 'concepts', pass: details.length === 0, value: `${count} concepts`, details };
}

/** The plan comes before the design: every required page planned, every photo reviewed. */
function planGate(): Gate {
  if (!siteType) return { name: 'plan', pass: true, value: 'skipped (no acta/site-type.json)' };
  if (!existsSync('acta/plan.md')) return { name: 'plan', pass: false, value: 'missing', details: ['acta/plan.md does not exist: run the planning phase'] };
  const plan = readFileSync('acta/plan.md', 'utf8');
  const details: string[] = [];
  for (const r of siteType.pages.map((p) => p.route)) if (!plan.includes(r)) details.push(`plan does not cover ${r}`);
  const photos = existsSync('public/brand/photos') ? readdirSync('public/brand/photos').filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) : [];
  if (photos.length && !/##\s*photo audit/i.test(plan)) details.push('plan has no "## Photo audit" section');
  for (const f of photos) if (!plan.includes(f)) details.push(`photo ${f} not reviewed in the plan's photo audit`);
  return { name: 'plan', pass: details.length === 0, value: `${siteType.pages.length} pages, ${photos.length} photos`, details };
}

async function crawl(base: string): Promise<Map<string, Page>> {
  const pages = new Map<string, Page>();
  const queue = ['/'];
  while (queue.length && pages.size < 200) {
    const path = queue.shift()!;
    if (pages.has(path)) continue;
    const res = await fetch(base + path, { redirect: 'manual' });
    const html = res.headers.get('content-type')?.includes('html') ? await res.text() : '';
    const $ = cheerio.load(html);
    const links = $('a[href]').map((_, a) => $(a).attr('href')!).get();
    pages.set(path, { path, status: res.status, html, text: $('body').text().replace(/\s+/g, ' '), headers: res.headers, links });
    for (const l of links) {
      if (/^(tel:|mailto:|javascript:|https?:\/\/|#)/i.test(l)) continue;
      const p = l.split('#')[0].split('?')[0] || '/';
      if (p.startsWith('/') && !p.startsWith('/_next') && !pages.has(p) && !queue.includes(p)) queue.push(p);
    }
  }
  return pages;
}

const pub = (src: string) => (src.startsWith('/_next/image') ? decodeURIComponent(new URL(src, 'http://x').searchParams.get('url') ?? '') : src.split('?')[0]);

/**
 * What an image weighs as served to a phone, not what the source file weighs: for next/image, the srcset candidate a
 * 390px phone at 2x would pick (the largest at or under 828px), fetched with a browser's Accept header so the optimiser
 * answers with AVIF or WebP as it would for a visitor; for a plain <img>, the file itself.
 */
async function servedKb(base: string, src: string, srcset: string): Promise<{ kb: number; via: 'next/image' | 'file' } | null> {
  let url = src;
  if (src.startsWith('/_next/image')) {
    const cands = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).map((u) => ({ u, w: Number(new URL(u, 'http://x').searchParams.get('w')) || 0 }));
    const phone = cands.filter((c) => c.w && c.w <= 828).sort((a, b) => b.w - a.w)[0];
    url = phone?.u ?? src;
  } else if (!src.startsWith('/')) return null;
  try {
    const r = await fetch(new URL(url, base), { headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    if (!r.ok) return null;
    return { kb: (await r.arrayBuffer()).byteLength / 1024, via: url.startsWith('/_next/image') ? 'next/image' : 'file' };
  } catch { return null; }
}

async function lighthouseGate(base: string): Promise<Gate> {
  const [{ default: lighthouse }, chromeLauncher] = await Promise.all([import('lighthouse'), import('chrome-launcher')]);
  const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
  try {
    const targets = ['/', site.services[0] ? `/services/${site.services[0].slug}` : null].filter(Boolean) as string[];
    const scores: Record<string, number> = { performance: 100, seo: 100, accessibility: 100, 'best-practices': 100 };
    const details: string[] = [];
    for (const t of targets) {
      const r = await lighthouse(base + t, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'seo', 'accessibility', 'best-practices'] });
      const cats = r?.lhr.categories ?? {};
      const line: string[] = [];
      for (const k of Object.keys(scores)) {
        let s = Math.round((cats[k]?.score ?? 0) * 100);
        // In preview mode the site is deliberately noindex, which Lighthouse counts against SEO. Score the rest of the category instead.
        if (k === 'seo' && process.env.ACTA_PREVIEW === '1' && cats.seo && r?.lhr.audits) {
          const refs = cats.seo.auditRefs.filter((a) => !['is-crawlable', 'robots-txt'].includes(a.id) && a.weight > 0);
          const total = refs.reduce((n, a) => n + a.weight, 0);
          const got = refs.reduce((n, a) => n + a.weight * (r.lhr.audits[a.id]?.score ?? 0), 0);
          s = total ? Math.round((got / total) * 100) : s;
        }
        scores[k] = Math.min(scores[k], s);
        line.push(`${k}=${s}`);
      }
      details.push(`${t}: ${line.join(' ')}`);
      mkdirSync('acta/qa', { recursive: true });
      writeFileSync(`acta/qa/lighthouse${t === '/' ? '-home' : '-service'}.json`, JSON.stringify(r?.lhr ?? {}));
    }
    // Shared CI runners are slower and noisier than a laptop, so the same site scores lower there. Accessibility
    // and SEO don't depend on CPU and keep their thresholds; performance gets CI slack. The real bar is the local gate.
    const perfMin = Number(process.env.ACTA_PERF_MIN ?? (flag('--ci') ? 75 : 90));
    const pass = scores.performance >= perfMin && scores.seo >= 95 && scores.accessibility >= 90;
    return { name: 'lighthouse', pass, value: `perf ${scores.performance} seo ${scores.seo} a11y ${scores.accessibility} bp ${scores['best-practices']}`, threshold: `perf>=${perfMin} seo>=95 a11y>=90 (mobile${flag('--ci') ? ', CI runner' : ''}${process.env.ACTA_PREVIEW === '1' ? ', crawlability excluded in preview' : ''})`, details };
  } finally {
    await chrome.kill();
  }
}

async function linksGate(base: string, pages: Map<string, Page>): Promise<Gate> {
  const details: string[] = [];
  for (const p of pages.values()) if (p.status !== 200) details.push(`${p.path} -> ${p.status}`);
  const external = new Set<string>();
  for (const p of pages.values()) for (const l of p.links) if (/^https?:\/\//i.test(l) && !/wa\.me/.test(l)) external.add(l);
  await Promise.all([...external].map(async (u) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      let r = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
      if (r.status === 405 || r.status === 403) r = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      if (r.status >= 400) details.push(`${u} -> ${r.status}`);
    } catch (e) { details.push(`${u} -> ${(e as Error).name}`); }
  }));
  return { name: 'links', pass: details.length === 0, value: `${pages.size} pages, ${external.size} external`, details };
}

/** Every image has alt text, weighs little as served to a phone, and the home page uses their photos. Sources stay large; next/image does the serving. */
async function imagesGate(base: string, pages: Map<string, Page>, brandPhotos: number): Promise<Gate> {
  const details: string[] = [];
  const measured = new Map<string, Awaited<ReturnType<typeof servedKb>>>();
  let heroChecked = false;
  for (const p of pages.values()) {
    const $ = cheerio.load(p.html);
    for (const el of $('img').toArray()) {
      const alt = $(el).attr('alt');
      const decorative = $(el).attr('aria-hidden') === 'true' || $(el).attr('role') === 'presentation';
      const src = $(el).attr('src') ?? '';
      if ((alt === undefined || alt.trim() === '') && !decorative) details.push(`${p.path}: <img src="${src.slice(0, 60)}"> has no alt`);
      if (!src.startsWith('/')) continue;
      const file = pub(src);
      const isPhoto = /^\/(brand\/photos|images)\//.test(file);
      const key = `${src}|${$(el).attr('srcset') ?? ''}`;
      if (!measured.has(key)) measured.set(key, measured.size < 60 ? await servedKb(base, src, $(el).attr('srcset') ?? '') : null);
      const m = measured.get(key);
      if (!m) continue;
      if (m.kb > 250) details.push(`${p.path}: ${file} serves ${Math.round(m.kb)} KB on a phone (max 250)${m.via === 'file' && isPhoto ? '; render photos with next/image and a sizes attribute' : ''}`);
      if (p.path === '/' && isPhoto && !heroChecked) { heroChecked = true; if (m.kb > 200) details.push(`hero photo ${file} serves ${Math.round(m.kb)} KB on a phone (max 200): check its sizes attribute and quality`); }
    }
  }
  const home = pages.get('/');
  if (brandPhotos > 0 && home && !home.html.includes('/brand/photos/')) details.push('brand.json has photos but / uses none of them');
  return { name: 'images', pass: details.length === 0, value: `${brandPhotos} brand photos available, ${measured.size} images weighed as served`, details };
}

function factsGate(pages: Map<string, Page>): Gate {
  const details: string[] = [];
  const home = pages.get('/');
  const b = site.business;
  if (!home) return { name: 'facts', pass: false, details: ['no home page'] };
  if (!home.text.includes(b.name)) details.push(`business name "${b.name}" missing from /`);
  if (b.phone_display && !home.text.includes(b.phone_display)) details.push(`phone "${b.phone_display}" missing from /`);
  if (b.phone_e164 && !home.html.includes(`tel:${b.phone_e164}`)) details.push(`tel:${b.phone_e164} link missing from /`);
  if (b.postcode && !home.text.includes(b.postcode)) details.push(`postcode ${b.postcode} missing from /`);
  for (const s of site.services) {
    const p = pages.get(`/services/${s.slug}`);
    if (!p) details.push(`/services/${s.slug} not reachable from /`);
    else if (!p.text.includes(s.name)) details.push(`/services/${s.slug} does not mention "${s.name}"`);
  }
  return { name: 'facts', pass: details.length === 0, details };
}

function claimsGate(pages: Map<string, Page>, facts: { claims: { claim: string }[] } | null): Gate {
  if (!facts) return { name: 'claims', pass: true, value: 'skipped', details: ['acta/facts.json missing, claims not checked'] };
  const details: string[] = [];
  const claims = [...facts.claims.map((c) => c.claim), ...site.claims];
  for (const p of pages.values()) for (const u of unbackedClaims(p.text, claims)) details.push(`${p.path}: "${u}" has no evidence in facts.json`);
  return { name: 'claims', pass: details.length === 0, value: `${claims.length} evidenced claims`, details };
}

function contrastGate(): Gate {
  const c = theme.colors as Record<string, string>;
  const pairs: [string, string][] = [['text', 'background'], ['muted', 'background'], ['text', 'surface'], ['muted', 'surface'], ['onPrimary', 'primary'], ['primary', 'background'], ['accent', 'background']];
  const details: string[] = [];
  for (const [fg, bg] of pairs) {
    if (!c[fg] || !c[bg]) continue;
    const r = contrastRatio(c[fg], c[bg]);
    if (r < 4.5) details.push(`${fg} on ${bg}: ${r.toFixed(2)}:1`);
  }
  return { name: 'contrast', pass: details.length === 0, threshold: '4.5:1 (WCAG AA)', details };
}

async function brandGate(base: string, pages: Map<string, Page>, brand: { logo: { path: string | null }; palette: { primary: string | null } } | null): Promise<Gate> {
  if (!brand) return { name: 'brand', pass: true, value: 'skipped', details: ['acta/brand.json missing, brand not checked'] };
  const details: string[] = [];
  const home = pages.get('/')!;
  const $ = cheerio.load(home.html);
  let css = home.html;
  for (const href of $('link[rel="stylesheet"]').map((_, l) => $(l).attr('href')!).get()) {
    try { css += await (await fetch(href.startsWith('http') ? href : base + href)).text(); } catch { /* ignore */ }
  }
  if (brand.logo.path) {
    const publicPath = brand.logo.path.replace(/^public/, '');
    if (!home.html.includes(publicPath)) details.push(`logo ${publicPath} not used on /`);
  }
  if (brand.palette.primary && !css.toLowerCase().includes(brand.palette.primary.toLowerCase())) details.push(`primary colour ${brand.palette.primary} not found in CSS or inline styles`);
  if (!css.toLowerCase().includes(theme.fonts.heading.toLowerCase())) details.push(`heading font "${theme.fonts.heading}" not loaded`);
  return { name: 'brand', pass: details.length === 0, details };
}

function reachGate(pages: Map<string, Page>): Gate {
  const details: string[] = [];
  const home = pages.get('/')!;
  const b = site.business;
  if (b.phone_e164 && !home.html.includes(`href="tel:${b.phone_e164}"`)) details.push('no tel: link on /');
  if (b.whatsapp && !home.html.includes(b.whatsapp)) details.push('whatsapp link missing on /');
  const contact = pages.get('/contact');
  if (!contact) details.push('/contact not reachable from /');
  else if (!/<form/i.test(contact.html)) details.push('/contact has no form');
  return { name: 'reach', pass: details.length === 0, details };
}

async function previewGate(base: string, pages: Map<string, Page>): Promise<Gate> {
  const preview = process.env.ACTA_PREVIEW === '1';
  const details: string[] = [];
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  const tag = pages.get('/')!.headers.get('x-robots-tag') ?? '';
  if (preview) {
    if (!/noindex/i.test(tag)) details.push('ACTA_PREVIEW=1 but X-Robots-Tag lacks noindex');
    if (!/disallow:\s*\/\s*$/im.test(robots)) details.push('ACTA_PREVIEW=1 but robots.txt does not disallow all');
  } else {
    if (/noindex/i.test(tag)) details.push('not a preview but X-Robots-Tag has noindex');
    if (!/allow:\s*\//i.test(robots) || /disallow:\s*\/\s*$/im.test(robots)) details.push('not a preview but robots.txt blocks crawling');
  }
  return { name: 'preview', pass: details.length === 0, value: preview ? 'preview mode' : 'live mode', details };
}

async function sitemapGate(base: string): Promise<Gate> {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const want = [...new Set(['/', ...requiredRoutes(), ...site.services.map((s) => `/services/${s.slug}`), ...site.areas.map((a) => `/areas/${a.slug}`)])];
  const details = want.filter((p) => !new RegExp(`<loc>[^<]*${p.replace(/[/]/g, '\\/')}<\\/loc>`).test(xml) && !(p === '/' && /<loc>[^<]*<\/loc>/.test(xml))).map((p) => `${p} missing from sitemap.xml`);
  return { name: 'sitemap', pass: details.length === 0, value: `${want.length} expected urls`, details };
}

async function main() {
  const given = opt('--url');
  const server = given ? null : await startBuilt({ build: true, log });
  const base = given ?? server!.url;
  const gates: Gate[] = [];
  try {
    const brand = existsSync('acta/brand.json') ? BrandSchema.parse(JSON.parse(readFileSync('acta/brand.json', 'utf8'))) : null;
    const facts = existsSync('acta/facts.json') ? FactsSchema.parse(JSON.parse(readFileSync('acta/facts.json', 'utf8'))) : null;
    log('crawling');
    const pages = await crawl(base);
    const push = (g: Gate) => { gates.push(g); log(`${g.pass ? 'PASS' : 'FAIL'} ${g.name}${g.value ? ` (${g.value})` : ''}${g.details?.length && !g.pass ? `\n  ${g.details.slice(0, 8).join('\n  ')}` : ''}`); };
    if (!flag('--skip-lighthouse')) { log('lighthouse'); push(await lighthouseGate(base)); } else gates.push({ name: 'lighthouse', pass: true, value: 'skipped (--skip-lighthouse)' });
    push(await linksGate(base, pages));
    push(await imagesGate(base, pages, brand?.photos.length ?? 0));
    push(factsGate(pages));
    push(claimsGate(pages, facts));
    push(contrastGate());
    push(await brandGate(base, pages, brand));
    push(reachGate(pages));
    push(await previewGate(base, pages));
    push(await sitemapGate(base));
    push(await pagesGate(base, pages));
    push(mapGate(pages));
    push(planGate());
    push(conceptsGate());
    push(await iconsGate(base, pages));
    push(droppedPhotosGate(pages));
  } finally {
    server?.stop();
  }
  let sha = 'nogit';
  try { sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo yet */ }
  const report: GateReport = GateReportSchema.parse({ pass: gates.every((g) => g.pass), head_sha: sha, ran_at: new Date().toISOString(), ci: flag('--ci') || undefined, gates });
  mkdirSync('acta/qa', { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  log(`${report.pass ? 'ALL GATES PASS' : 'GATES FAILED: ' + gates.filter((g) => !g.pass).map((g) => g.name).join(', ')} -> ${OUT}`);
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
