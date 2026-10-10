/**
 * Telling you something needs you, without you watching the terminal: a macOS notification, and optionally a push
 * to your phone through ACTA_NOTIFY_URL (an ntfy.sh topic URL, or any URL that takes a POST with the text).
 * Nothing here is ever sent to a business.
 */
import { run } from '../build/exec.js';
import { log } from '../util/log.js';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');

/** The AppleScript for one notification. Pure. */
export const appleScript = (title: string, text: string) => `display notification "${esc(text)}" with title "${esc(title)}" sound name "Glass"`;

export const pushConfigured = () => !!process.env.ACTA_NOTIFY_URL;

export async function notify(title: string, text: string, opts: { url?: string | null } = {}): Promise<void> {
  const problems: string[] = [];
  if (process.platform === 'darwin' && process.env.ACTA_NOTIFY_MAC !== 'off') {
    const r = await run('osascript', ['-e', appleScript(title, text)], { cwd: '/tmp', timeoutMs: 10_000 }).catch(() => null);
    if (!r || r.code !== 0) problems.push(`macOS notification: ${(r?.stderr || 'osascript failed').trim().slice(0, 120)}`);
  }
  const url = process.env.ACTA_NOTIFY_URL;
  if (url) {
    try {
      const headers: Record<string, string> = { Title: title.replace(/[^\x20-\x7e]/g, ''), 'content-type': 'text/plain; charset=utf-8' };
      if (opts.url) headers.Click = opts.url;
      const res = await fetch(url, { method: 'POST', headers, body: opts.url ? `${text}\n${opts.url}` : text, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) problems.push(`push to ACTA_NOTIFY_URL: HTTP ${res.status}`);
    } catch (e) { problems.push(`push to ACTA_NOTIFY_URL: ${(e as Error).message}`); }
  }
  for (const p of problems) log.warn(`notify: ${p}`);
  log.info(`notify: ${title}. ${text}`);
}
