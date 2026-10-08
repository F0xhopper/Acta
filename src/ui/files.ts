/** Safe file serving for the UI: a kind maps to a root directory, and nothing may escape it. */
import { existsSync, statSync } from 'node:fs';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { DATA_DIR, OUT_DIR, ROOT, SCREENSHOT_DIR } from '../config.js';

export type FileKind = 'site' | 'brand' | 'build' | 'delivery' | 'out' | 'shots';

export function rootFor(kind: string, slug: string): string | null {
  if (!/^[a-z0-9_][a-z0-9_.-]*$/i.test(slug) || slug.includes('..')) return null;
  switch (kind) {
    case 'site': return join(ROOT, 'sites', slug);
    case 'brand': return join(DATA_DIR, 'brand', slug);
    case 'build': return join(DATA_DIR, 'builds', slug);
    case 'delivery': return join(OUT_DIR, 'deliveries', slug);
    case 'out': return OUT_DIR;
    case 'shots': return SCREENSHOT_DIR;   // audit screenshots of the business's current site: /files/shots/<slug>/<slug>-mobile.png
    default: return null;
  }
}

/**
 * Resolve /files/:kind/:slug/<rest> to an absolute path, or null when it would escape the root,
 * is not allowed for the kind, or does not exist. For kind "out" the slug is the first path segment.
 */
export function resolveFile(kind: string, slug: string, rest: string, mustExist = true): string | null {
  const root = rootFor(kind, kind === 'out' ? 'out' : slug);
  if (!root) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(rest); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const relPath = kind === 'out' ? join(slug, decoded) : decoded;
  const abs = resolve(root, normalize(relPath));
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || resolve(rel) === rel) return null;
  if (kind === 'site') {
    const top = rel.split(sep)[0];
    if (top !== 'acta' && top !== 'public') return null;
  }
  if (mustExist && (!existsSync(abs) || !statSync(abs).isFile())) return null;
  return abs;
}

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8',
  zip: 'application/zip', eml: 'message/rfc822', html: 'text/html; charset=utf-8', log: 'text/plain; charset=utf-8',
};
export function contentType(path: string): string {
  return TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** The /files URL for an absolute path under one of the roots, or null. */
export function fileUrl(kind: FileKind, slug: string, abs: string | null | undefined): string | null {
  if (!abs || !existsSync(abs)) return null;
  const root = rootFor(kind, kind === 'out' ? 'out' : slug);
  if (!root) return null;
  const rel = relative(root, abs);
  if (rel.startsWith('..')) return null;
  const parts = rel.split(sep).map(encodeURIComponent).join('/');
  return kind === 'out' ? `/files/out/${parts}` : `/files/${kind}/${encodeURIComponent(slug)}/${parts}`;
}
