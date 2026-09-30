import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => { const a = s.address(); s.close(() => (typeof a === 'object' && a ? resolve(a.port) : reject(new Error('no port')))); });
  });
}

export async function waitFor(url: string, ms = 60000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not come up in ${ms} ms`);
}

export interface Running { url: string; port: number; stop: () => void }

/** Build if needed, then `next start` on a free port. Env is inherited, so ACTA_PREVIEW flows through. */
export async function startBuilt(opts: { build?: boolean; log?: (s: string) => void } = {}): Promise<Running> {
  const log = opts.log ?? (() => undefined);
  if (opts.build || !existsSync('.next/BUILD_ID')) {
    log('building');
    await run('pnpm', ['exec', 'next', 'build']);
  }
  const port = await freePort();
  const child: ChildProcess = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  child.stdout?.on('data', (d) => log(`[next] ${String(d).trim()}`));
  child.stderr?.on('data', (d) => log(`[next] ${String(d).trim()}`));
  const url = `http://localhost:${port}`;
  await waitFor(url);
  return { url, port, stop: () => { child.kill('SIGTERM'); } };
}

export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', env });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
    c.on('error', reject);
  });
}
