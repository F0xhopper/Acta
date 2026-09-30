// Claude Code Stop hook: the agent may not finish while the fast gates fail.
// Prints the failing gate names and details, exits 2 to block the stop with that reason.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
try { if (JSON.parse(input || '{}').stop_hook_active) process.exit(0); } catch { /* ignore */ }

const r = spawnSync('pnpm', ['-s', 'gate:fast'], { encoding: 'utf8', env: process.env });
if (r.status === 0) process.exit(0);
let reason = 'pnpm gate:fast failed';
if (existsSync('acta/qa/gate.json')) {
  const rep = JSON.parse(readFileSync('acta/qa/gate.json', 'utf8'));
  const failing = rep.gates.filter((g) => !g.pass);
  reason = `Gates failing: ${failing.map((g) => g.name).join(', ')}.\n` + failing.map((g) => `- ${g.name}: ${(g.details ?? []).slice(0, 6).join('; ')}`).join('\n') + '\nFix these, re-run pnpm gate:fast, then finish.';
} else {
  reason += `\n${(r.stdout + r.stderr).split('\n').slice(-30).join('\n')}`;
}
console.error(reason);
process.exit(2);
