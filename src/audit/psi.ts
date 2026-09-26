import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, env } from '../config.js';
import { fetchWithTimeout, HttpError, retry } from '../util/http.js';

export interface PsiResult { perf: number | null; seo: number | null; a11y: number | null; bp: number | null; jsonPath: string | null; error: string | null }

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export async function runPsi(url: string, slug: string, onRequest?: () => void): Promise<PsiResult> {
  const key = env('GOOGLE_PSI_API_KEY', process.env.GOOGLE_PLACES_API_KEY ?? '');
  const params = new URLSearchParams({ url, strategy: 'mobile', key });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) params.append('category', c);
  try {
    const data = await retry(async () => {
      onRequest?.();
      const res = await fetchWithTimeout(`${PSI_URL}?${params}`, { timeoutMs: 75000 });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, `PSI ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text) as { lighthouseResult?: { categories?: Record<string, { score?: number | null }> } };
    }, { attempts: 1, baseMs: 5000, shouldRetry: (e) => e instanceof HttpError && (e.status === 429 || e.status >= 500) });
    const cats = data.lighthouseResult?.categories ?? {};
    const pct = (k: string) => { const s = cats[k]?.score; return typeof s === 'number' ? Math.round(s * 100) : null; };
    const dir = join(CACHE_DIR, 'psi');
    mkdirSync(dir, { recursive: true });
    const jsonPath = join(dir, `${slug}.json`);
    writeFileSync(jsonPath, JSON.stringify(data));
    return { perf: pct('performance'), seo: pct('seo'), a11y: pct('accessibility'), bp: pct('best-practices'), jsonPath, error: null };
  } catch (e) {
    return { perf: null, seo: null, a11y: null, bp: null, jsonPath: null, error: (e as Error).message.slice(0, 300) };
  }
}
