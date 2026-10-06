import { spawn } from 'node:child_process';

export interface ExecResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; seconds: number }
export interface ExecOpts { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string; onLine?: (line: string) => void; inheritEnv?: boolean; onSpawn?: (pid: number) => void }

/** Run a command, capture output, kill the whole process group on timeout. */
export function run(cmd: string, args: string[], opts: ExecOpts): Promise<ExecResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.inheritEnv === false ? opts.env : { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    if (child.pid) opts.onSpawn?.(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let partial = '';
    const feed = (chunk: string) => {
      stdout += chunk;
      if (!opts.onLine) return;
      partial += chunk;
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';
      for (const l of lines) opts.onLine(l);
    };
    child.stdout.on('data', (b) => feed(b.toString()));
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    const timer = opts.timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, opts.timeoutMs) : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (partial && opts.onLine) opts.onLine(partial);
      resolve({ code, stdout, stderr, timedOut, seconds: Math.round((Date.now() - t0) / 1000) });
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut, seconds: Math.round((Date.now() - t0) / 1000) });
    });
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

export async function must(cmd: string, args: string[], opts: ExecOpts): Promise<ExecResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.timedOut ? 'timeout' : `exit ${r.code}`}): ${(r.stderr || r.stdout).trim().split('\n').slice(-6).join(' | ').slice(0, 800)}`);
  return r;
}

export const git = (cwd: string, ...args: string[]) => must('git', args, { cwd });
