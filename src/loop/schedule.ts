/**
 * launchd jobs under ~/Library/LaunchAgents. Two ways to run Acta on its own:
 *   - the always-on server (com.acta.ui, KeepAlive): `pnpm pipeline ui` kept running whenever the Mac is on. With
 *     the autopilot switched on (config/build.yaml) it runs the daily lead search, housekeeping, the Sunday re-score,
 *     and picks and builds by itself. This is what `schedule install` installs when the autopilot is on.
 *   - the four calendar jobs (leads daily, week on Sunday, builds Monday and Tuesday night, day on weekday mornings),
 *     for running the stages at fixed times without the server. Installed when the autopilot is off.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../config.js';
import { run } from '../build/exec.js';
import { loadAutomation } from './automation.js';

const AGENTS = join(homedir(), 'Library', 'LaunchAgents');
const LOGS = join(ROOT, 'data', 'logs');

interface Cal { Weekday?: number; Hour: number; Minute: number }
interface Job { label: string; command: string; calendar?: Cal[]; keepAlive?: boolean }

export const JOBS: Job[] = [
  { label: 'com.acta.ui', command: 'ui', keepAlive: true },
  { label: 'com.acta.leads', command: 'leads', calendar: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ Weekday: d, Hour: 7, Minute: 30 })) },
  { label: 'com.acta.week', command: 'week', calendar: [{ Weekday: 0, Hour: 22, Minute: 0 }] },
  { label: 'com.acta.builds', command: 'build --picked --max 5', calendar: [{ Weekday: 1, Hour: 1, Minute: 0 }, { Weekday: 2, Hour: 1, Minute: 0 }] },
  { label: 'com.acta.day', command: 'day', calendar: [1, 2, 3, 4, 5].map((d) => ({ Weekday: d, Hour: 9, Minute: 15 })) },
];
const short = (label: string) => label.replace('com.acta.', '');

/** The jobs installed when none are named: the always-on server with the autopilot on, the calendar jobs otherwise. Pure given the flag. */
export const defaultJobs = (autopilot = loadAutomation().autopilot): string[] => (autopilot ? ['ui'] : ['leads', 'week', 'builds', 'day']);

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const whenText = (j: Job) => (j.keepAlive ? 'always on, restarted if it stops' : (j.calendar ?? []).map((c) => `${DAY[c.Weekday ?? 0]} ${String(c.Hour).padStart(2, '0')}:${String(c.Minute).padStart(2, '0')}`).join(', '));

export function plist(j: Job): string {
  const script = `cd "${ROOT}" && export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" && pnpm -s pipeline ${j.command} >> "${LOGS}/${j.label}.log" 2>&1`;
  const timing = j.keepAlive
    ? `  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>30</integer>`
    : `  <key>StartCalendarInterval</key><array>\n${(j.calendar ?? []).map((c) => `      <dict>${Object.entries(c).map(([k, v]) => `<key>${k}</key><integer>${v}</integer>`).join('')}</dict>`).join('\n')}\n  </array>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${j.label}</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>${script.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</string></array>
${timing}
  <key>StandardOutPath</key><string>${LOGS}/${j.label}.out</string>
  <key>StandardErrorPath</key><string>${LOGS}/${j.label}.err</string>
</dict></plist>
`;
}

/** Install the named jobs, or the default set; with the default set, jobs outside it are removed so nothing runs twice. */
export async function installSchedule(only?: string[]): Promise<string[]> {
  mkdirSync(AGENTS, { recursive: true });
  mkdirSync(LOGS, { recursive: true });
  const names = only?.length ? only : defaultJobs();
  const notes: string[] = [];
  for (const j of JOBS) {
    const p = join(AGENTS, `${j.label}.plist`);
    if (names.includes(short(j.label))) {
      writeFileSync(p, plist(j));
      await run('launchctl', ['unload', p], { cwd: ROOT });
      const r = await run('launchctl', ['load', p], { cwd: ROOT });
      notes.push(`${j.label}: ${r.code === 0 ? 'loaded' : (r.stderr || r.stdout).trim()} (${whenText(j)})`);
    } else if (!only?.length && existsSync(p)) {
      await run('launchctl', ['unload', p], { cwd: ROOT });
      unlinkSync(p);
      notes.push(`${j.label}: removed, not part of this setup (the ${names.includes('ui') ? 'always-on server runs it' : 'calendar jobs replace it'})`);
    }
  }
  if (names.includes('ui')) notes.push('If `pnpm ui` is open in a terminal, stop it (Ctrl+C): the always-on server takes over on http://127.0.0.1:4321. Logs: data/logs/com.acta.ui.log');
  return notes;
}

export async function uninstallSchedule(): Promise<string[]> {
  const notes: string[] = [];
  for (const j of JOBS) {
    const p = join(AGENTS, `${j.label}.plist`);
    if (!existsSync(p)) { notes.push(`${j.label}: not installed`); continue; }
    await run('launchctl', ['unload', p], { cwd: ROOT });
    unlinkSync(p);
    notes.push(`${j.label}: removed`);
  }
  return notes;
}

export async function scheduleStatus(): Promise<string[]> {
  const lc = await run('launchctl', ['list'], { cwd: ROOT });
  const installed = existsSync(AGENTS) ? readdirSync(AGENTS).filter((f) => f.startsWith('com.acta.')) : [];
  const def = defaultJobs();
  return JOBS.map((j) => `${j.label}: ${installed.includes(`${j.label}.plist`) ? 'installed' : 'not installed'}, ${lc.stdout.includes(j.label) ? 'loaded' : 'not loaded'} · ${whenText(j)}${def.includes(short(j.label)) ? '' : ' · not in the current setup'}`);
}

/** Whether a job's plist is installed, without asking launchctl. `name` is the short name: ui, leads, week, day, builds. */
export const jobInstalled = (name: string) => existsSync(join(AGENTS, `com.acta.${name}.plist`));
