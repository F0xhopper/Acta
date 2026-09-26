import { fetchWithTimeout, hostOf, MOBILE_UA } from '../util/http.js';

export interface FetchResult {
  inputUrl: string;
  finalUrl: string | null;
  finalDomain: string | null;
  httpStatus: number | null;
  tlsError: string | null;
  error: string | null;
  redirectCount: number;
  redirectLoop: boolean;
  ttfbMs: number | null;
  httpsOk: boolean | null;
  httpRedirectsToHttps: boolean | null;
  body: string;
  headers: Record<string, string>;
  contentType: string | null;
}

const TLS_CODES = new Set(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER', 'EPROTO', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'HOSTNAME_MISMATCH']);

function errorInfo(e: unknown): { code: string; tls: boolean } {
  const err = e as { name?: string; code?: string; cause?: { code?: string; message?: string }; message?: string };
  if (err?.name === 'AbortError') return { code: 'timeout', tls: false };
  const code = err?.cause?.code ?? err?.code ?? 'unknown';
  const msg = `${err?.cause?.message ?? ''} ${err?.message ?? ''}`.toLowerCase();
  const tls = TLS_CODES.has(code) || /certificate|ssl|tls/.test(msg);
  return { code, tls };
}

const MAX_BODY = 2 * 1024 * 1024;

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString('utf8');
}

/** Follow redirects manually so we can count them and detect loops. */
async function followChain(startUrl: string, timeoutMs: number): Promise<{ res: Response | null; finalUrl: string; redirects: number; loop: boolean; ttfbMs: number; error: unknown }> {
  let url = startUrl;
  const seen = new Set<string>();
  let redirects = 0;
  const t0 = Date.now();
  for (;;) {
    if (seen.has(url) || redirects > 6) return { res: null, finalUrl: url, redirects, loop: true, ttfbMs: Date.now() - t0, error: null };
    seen.add(url);
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { timeoutMs, redirect: 'manual', headers: { 'user-agent': MOBILE_UA } });
    } catch (e) {
      return { res: null, finalUrl: url, redirects, loop: false, ttfbMs: Date.now() - t0, error: e };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { res, finalUrl: url, redirects, loop: false, ttfbMs: Date.now() - t0, error: null };
      url = new URL(loc, url).toString();
      redirects++;
      continue;
    }
    return { res, finalUrl: url, redirects, loop: false, ttfbMs: Date.now() - t0, error: null };
  }
}

export async function fetchHomepage(inputUrl: string, timeoutMs = 15000): Promise<FetchResult> {
  const out: FetchResult = {
    inputUrl, finalUrl: null, finalDomain: null, httpStatus: null, tlsError: null, error: null, redirectCount: 0, redirectLoop: false,
    ttfbMs: null, httpsOk: null, httpRedirectsToHttps: null, body: '', headers: {}, contentType: null,
  };
  const chain = await followChain(inputUrl, timeoutMs);
  out.finalUrl = chain.finalUrl;
  out.finalDomain = hostOf(chain.finalUrl);
  out.redirectCount = chain.redirects;
  out.redirectLoop = chain.loop;
  out.ttfbMs = chain.ttfbMs;
  if (chain.error) {
    const info = errorInfo(chain.error);
    if (info.tls) out.tlsError = info.code; else out.error = info.code;
  } else if (chain.res) {
    out.httpStatus = chain.res.status;
    out.contentType = chain.res.headers.get('content-type');
    chain.res.headers.forEach((v, k) => { out.headers[k.toLowerCase()] = v; });
    out.body = await readBody(chain.res);
  }
  const finalIsHttps = !!out.finalUrl && out.finalUrl.startsWith('https://');
  const inputIsHttp = inputUrl.startsWith('http://');
  if (finalIsHttps && !out.tlsError && !out.error) {
    out.httpsOk = true;
    out.httpRedirectsToHttps = inputIsHttp ? true : null;
  } else if (out.finalDomain) {
    // Probe https separately so "site works but only on http" is distinguishable from "no https at all".
    try {
      const probe = await fetchWithTimeout(`https://${out.finalDomain}/`, { timeoutMs: 8000, redirect: 'manual', method: 'HEAD' });
      out.httpsOk = probe.status < 500;
    } catch (e) {
      const info = errorInfo(e);
      out.httpsOk = false;
      if (info.tls && !out.tlsError && out.httpStatus === null) out.tlsError = info.code;
    }
    out.httpRedirectsToHttps = inputIsHttp ? false : null;
  }
  return out;
}
