/**
 * Talk to the running Acta server from the CLI, when there is one. Switching the autopilot from the terminal should
 * take effect now, not at the server's next minute, and the server's own view of things (its last tick) is better than
 * a fresh guess. Returns null when no server answers, so the caller falls back to doing the work itself.
 */
export async function pokeServer<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 4000): Promise<T | null> {
  const port = Number(process.env.ACTA_UI_PORT ?? 4321);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}
