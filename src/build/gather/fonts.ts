import type { PageData } from './types.js';

const GENERIC = new Set(['arial', 'helvetica', 'helvetica neue', 'sans-serif', 'serif', 'times', 'times new roman', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'ui-sans-serif', 'monospace', 'inherit', 'initial', 'verdana', 'tahoma', 'georgia', 'courier new']);

export function firstFamily(fontFamily: string | null | undefined): string | null {
  if (!fontFamily) return null;
  for (const raw of fontFamily.split(',')) {
    const f = raw.trim().replace(/^["']|["']$/g, '').trim();
    if (!f) continue;
    if (GENERIC.has(f.toLowerCase())) return null;      // the site relies on a system face
    if (/^wf_|^wfont_|_display$|_book$|^font\d/i.test(f)) return null; // Wix internal names
    const wix = f.match(/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*?)(?:-lt)?(?:-std)?[-_]w0\d/i);  // avenir-lt-w01_85-heavy1475544 -> Avenir
    if (wix) return wix[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return f;
  }
  return null;
}

export function googleFamilies(fontLinks: string[]): string[] {
  const out = new Set<string>();
  for (const href of fontLinks) {
    try {
      const u = new URL(href, 'https://fonts.googleapis.com');
      if (!u.hostname.includes('fonts.googleapis.com')) continue;
      for (const fam of u.searchParams.getAll('family')) {
        for (const part of fam.split('|')) {
          const name = decodeURIComponent(part.split(':')[0]).replace(/\+/g, ' ').trim();
          if (name) out.add(name);
        }
      }
    } catch { /* ignore */ }
  }
  return [...out];
}

export function extractFonts(pages: PageData[]): { heading: string | null; body: string | null; google: string[]; source: 'site' | 'none' } {
  const home = pages[0];
  const heading = firstFamily(home?.styles?.h1.fontFamily);
  const body = firstFamily(home?.styles?.body.fontFamily);
  const google = googleFamilies(pages.flatMap((p) => p.fontLinks));
  return { heading, body, google, source: heading || body || google.length ? 'site' : 'none' };
}
