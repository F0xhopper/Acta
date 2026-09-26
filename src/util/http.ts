export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  redirect?: RequestRedirect;
}

export async function fetchWithTimeout(url: string, opts: FetchOpts = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': MOBILE_UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...(opts.headers ?? {}) },
      body: opts.body,
      redirect: opts.redirect ?? 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retry an async function on failure with exponential backoff. `shouldRetry` decides per error. */
export async function retry<T>(
  fn: () => Promise<T>,
  { attempts = 2, baseMs = 1000, shouldRetry = () => true }: { attempts?: number; baseMs?: number; shouldRetry?: (e: unknown) => boolean } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts || !shouldRetry(e)) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public bodyText?: string) {
    super(message);
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True if host equals or is a subdomain of any entry in the list. */
export function hostMatches(host: string | null, list: string[]): boolean {
  if (!host) return false;
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}
