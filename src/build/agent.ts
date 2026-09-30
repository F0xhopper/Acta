import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './exec.js';

export interface AgentOpts { prompt: string; maxTurns: number; maxMinutes: number; resultPath: string; log?: (m: string) => void }
export interface AgentResult { ok: boolean; turns: number | null; seconds: number; costUsd: number | null; message: string; timedOut: boolean; raw: string }

export const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Agent', 'Skill', 'TodoWrite', 'WebFetch',
  'Bash(pnpm *)', 'Bash(pnpm exec *)', 'Bash(node scripts/*)', 'Bash(npx tsx *)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(ls*)', 'Bash(cat *)', 'Bash(mkdir *)', 'Bash(cp *)',
];

/** A clean environment: no pipeline tokens reach the agent. It keeps only what a shell needs, plus Claude's own config. */
function cleanEnv(): NodeJS.ProcessEnv {
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
  const args = ['-p', opts.prompt, '--output-format', 'json', '--max-turns', String(opts.maxTurns), '--allowedTools', ALLOWED_TOOLS.join(',')];
  say(`claude ${args.slice(0, 2).join(' ')} (max ${opts.maxTurns} turns, ${opts.maxMinutes} min)`);
  const r = await run('claude', args, { cwd: dir, env: cleanEnv(), inheritEnv: false, timeoutMs: opts.maxMinutes * 60_000 });
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
  const out: AgentResult = {
    ok: r.code === 0 && !r.timedOut && !isError,
    turns: parsed && typeof parsed.num_turns === 'number' ? parsed.num_turns : null,
    seconds: r.seconds,
    costUsd: parsed && typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
    message: message.slice(0, 2000),
    timedOut: r.timedOut,
    raw: r.stdout,
  };
  say(`agent ${out.ok ? 'finished' : 'failed'} in ${out.seconds}s${out.turns !== null ? `, ${out.turns} turns` : ''}${out.timedOut ? ', timed out' : ''}`);
  return out;
}

export function agentAvailable(): boolean {
  return process.platform !== 'win32' && (process.env.PATH ?? '').split(':').some((p) => existsSync(join(p, 'claude')));
}
