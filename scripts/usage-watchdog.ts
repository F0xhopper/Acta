// Stop running headless design agents when subscription usage reaches the threshold.
// Usage: pnpm exec tsx scripts/usage-watchdog.ts [threshold=70] [intervalSeconds=180]
// Prints one line per check and exits when no agent is running or after stopping one.
import { execSync } from 'node:child_process';
import { overLimit, readUsage } from '../src/build/usage.js';

const threshold = Number(process.argv[2] ?? process.env.ACTA_USAGE_STOP_PERCENT ?? 70);
const interval = Number(process.argv[3] ?? 180) * 1000;
const agentPids = () => { try { return execSync("pgrep -f 'claude -p /build|claude -p /revise'").toString().trim().split('\n').filter(Boolean); } catch { return []; } };

async function main() {
  for (;;) {
    const pids = agentPids();
    if (!pids.length) { console.log('watchdog: no design agent running, exiting'); return; }
    const u = await readUsage();
    const t = new Date().toTimeString().slice(0, 5);
    if (!u) { console.log(`${t} watchdog: could not read usage, will retry`); }
    else {
      const over = overLimit(u, threshold);
      if (over) {
        for (const p of pids) { try { process.kill(Number(p), 'SIGTERM'); } catch { /* gone */ } }
        console.log(`${t} watchdog: ${over} (threshold ${threshold}%), stopped the design agent`);
        return;
      }
      console.log(`${t} watchdog: session ${u.session}%, week ${u.week}%, under ${threshold}%`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
main();
