// Managed by Acta. Do not edit.
/**
 * One preview open: INCR seen:<slug>, set seen_first once and seen_last every time, in Upstash Redis over its REST
 * API. The pipeline reads the three keys back (src/outreach/opens.ts). Without the env vars, or outside a preview,
 * it does nothing and answers 204, so the route is harmless on a site that goes live.
 */
import { BOT_UA } from '@/kit/seen';

export async function POST(req: Request) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const slug = process.env.ACTA_SLUG;
  const ok = () => new Response(null, { status: 204 });
  if (!url || !token || !slug || process.env.ACTA_PREVIEW !== '1') return ok();
  if (BOT_UA.test(req.headers.get('user-agent') ?? '')) return ok();
  const now = new Date().toISOString();
  const commands = [['INCR', `seen:${slug}`], ['SET', `seen_first:${slug}`, now, 'NX'], ['SET', `seen_last:${slug}`, now]];
  try {
    await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands), signal: AbortSignal.timeout(5000),
    });
  } catch { /* counting is best effort; never fail the page */ }
  return ok();
}
