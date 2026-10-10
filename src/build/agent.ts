import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './exec.js';
import { overLimit, readUsage, usageThreshold } from './usage.js';

/** `session`: the conversation id. New runs start it with that id; `resume` carries on an earlier, paused one. */
export interface AgentOpts { prompt: string; maxTurns: number; maxMinutes: number; resultPath: string; session?: { id: string; resume: boolean }; log?: (m: string) => void }
/** `paused`: stopped at the usage limit (ours or Claude's own), so the conversation can be resumed rather than restarted. */
export interface AgentResult { ok: boolean; turns: number | null; seconds: number; costUsd: number | null; message: string; timedOut: boolean; raw: string; paused: boolean; started: boolean }

const CLAUDE_LIMIT = /session limit|usage limit|rate limit|resets? \d/i;

export const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Agent', 'Skill', 'TodoWrite', 'WebFetch',
  'Bash(pnpm *)', 'Bash(pnpm exec *)', 'Bash(node scripts/*)', 'Bash(npx tsx *)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(ls*)', 'Bash(cat *)', 'Bash(mkdir *)', 'Bash(cp *)',
];

/** A clean environment: no pipeline tokens reach the agent. It keeps only what a shell needs, plus Claude's own config. */
export function cleanEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'NODE_OPTIONS'];
  const out: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k]) out[k] = process.env[k];
  out.ACTA_BUILD = '1';
  out.ACTA_PREVIEW = '1';
  out.CI = '1';
  // Optional: bill headless builds to an API key instead of the Claude subscription's session allowance.
  if (process.env.ACTA_AGENT_API_KEY) out.ANTHROPIC_API_KEY = process.env.ACTA_AGENT_API_KEY;
  return out;
}

/** Run Claude Code headlessly inside a site repo. */
export async function runAgent(dir: string, opts: AgentOpts): Promise<AgentResult> {
  const say = opts.log ?? (() => undefined);
  const session = opts.session ? (opts.session.resume ? ['--resume', opts.session.id] : ['--session-id', opts.session.id]) : [];
  const args = ['-p', opts.prompt, ...session, '--output-format', 'json', '--max-turns', String(opts.maxTurns), '--allowedTools', ALLOWED_TOOLS.join(',')];
  say(`claude -p ${opts.session?.resume ? `(resuming ${opts.session.id.slice(0, 8)})` : opts.prompt} (max ${opts.maxTurns} turns, ${opts.maxMinutes} min)`);
  // Usage guard: poll the subscription's usage and stop the agent before it reaches the threshold.
  const threshold = usageThreshold();
  let stoppedFor: string | null = null;
  const before = await readUsage();
  if (before) {
    say(`usage before: session ${before.session ?? '?'}%, week ${before.week ?? '?'}% (stop at ${threshold}%)`);
    const over = overLimit(before, threshold);
    if (over) {
      writeFileSync(opts.resultPath, `not started: ${over}`);
      return { ok: false, turns: 0, seconds: 0, costUsd: null, message: `usage limit guard, ${over}, threshold ${threshold}%`, timedOut: false, raw: '', paused: true, started: false };
    }
  }
  const child = { pid: 0 };
  let guard: NodeJS.Timeout | null = null;
  const poll = async () => {
    const u = await readUsage().catch(() => null);
    if (!u) return;
    say(`usage: session ${u.session ?? '?'}%, week ${u.week ?? '?'}%`);
    const over = overLimit(u, threshold);
    if (over && child.pid && !stoppedFor) {
      stoppedFor = over;
      say(`usage guard: ${over}, stopping the agent`);
      // SIGINT, like Ctrl+C: Claude Code saves the conversation up to the last step, so a resume loses nothing.
      // SIGTERM can drop the last steps from the saved conversation. It's only the fallback.
      const pid = child.pid;
      try { process.kill(-pid, 'SIGINT'); } catch { /* gone */ }
      setTimeout(() => { try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ } }, 30_000).unref();
    }
  };
  guard = setInterval(() => { void poll(); }, 3 * 60_000);
  const r = await run('claude', args, { cwd: dir, env: cleanEnv(), inheritEnv: false, timeoutMs: opts.maxMinutes * 60_000, onSpawn: (pid) => { child.pid = pid; } });
  if (guard) clearInterval(guard);
  if (stoppedFor) {
    writeFileSync(opts.resultPath, r.stdout || r.stderr || `stopped: ${stoppedFor}`);
    return { ok: false, turns: null, seconds: r.seconds, costUsd: null, message: `usage limit guard, ${stoppedFor}, threshold ${threshold}%`, timedOut: false, raw: r.stdout, paused: true, started: true };
  }
  writeFileSync(opts.resultPath, r.stdout || r.stderr);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(r.stdout.trim());
  } catch {
    const last = r.stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
    if (last) { try { parsed = JSON.parse(last); } catch { /* leave null */ } }
  }
  const isError = parsed ? Boolean(parsed.is_error) : true;
  const message = parsed ? String(parsed.result ?? parsed.error ?? '') : (r.stderr || r.stdout).trim().split('\n').slice(-5).join(' | ');
  const ok = r.code === 0 && !r.timedOut && !isError;
  const out: AgentResult = {
    ok,
    turns: parsed && typeof parsed.num_turns === 'number' ? parsed.num_turns : null,
    seconds: r.seconds,
    costUsd: parsed && typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
    message: message.slice(0, 2000),
    timedOut: r.timedOut,
    raw: r.stdout,
    paused: !ok && CLAUDE_LIMIT.test(message),
    started: true,
  };
  say(`agent ${out.ok ? 'finished' : 'failed'} in ${out.seconds}s${out.turns !== null ? `, ${out.turns} turns` : ''}${out.timedOut ? ', timed out' : ''}`);
  return out;
}

export function agentAvailable(): boolean {
  return process.platform !== 'win32' && (process.env.PATH ?? '').split(':').some((p) => existsSync(join(p, 'claude')));
}
