import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../config.js';
import { run } from '../build/exec.js';

const AGENTS = join(homedir(), 'Library', 'LaunchAgents');
const LOGS = join(ROOT, 'data', 'logs');

interface Job { label: string; command: string; calendar: { Weekday?: number; Hour: number; Minute: number }[] }

/** Sunday night sweep, overnight builds Monday and Tuesday, a weekday morning job for everything else. */
export const JOBS: Job[] = [
  { label: 'com.acta.week', command: 'week', calendar: [{ Weekday: 0, Hour: 22, Minute: 0 }] },
  { label: 'com.acta.builds', command: 'build --picked --max 5', calendar: [{ Weekday: 1, Hour: 1, Minute: 0 }, { Weekday: 2, Hour: 1, Minute: 0 }] },
  { label: 'com.acta.day', command: 'day', calendar: [1, 2, 3, 4, 5].map((d) => ({ Weekday: d, Hour: 9, Minute: 15 })) },
];

const plist = (j: Job) => {
  const cal = j.calendar.map((c) => `      <dict>${Object.entries(c).map(([k, v]) => `<key>${k}</key><integer>${v}</integer>`).join('')}</dict>`).join('\n');
  const script = `cd "${ROOT}" && export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" && pnpm -s pipeline ${j.command} >> "${LOGS}/${j.label}.log" 2>&1`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${j.label}</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>${script.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</string></array>
  <key>StartCalendarInterval</key><array>
${cal}
  </array>
  <key>StandardOutPath</key><string>${LOGS}/${j.label}.out</string>
  <key>StandardErrorPath</key><string>${LOGS}/${j.label}.err</string>
</dict></plist>
`;
};

export async function installSchedule(only?: string[]): Promise<string[]> {
  mkdirSync(AGENTS, { recursive: true });
  mkdirSync(LOGS, { recursive: true });
  const notes: string[] = [];
  for (const j of JOBS.filter((j) => !only?.length || only.includes(j.label.replace('com.acta.', '')))) {
    const p = join(AGENTS, `${j.label}.plist`);
    writeFileSync(p, plist(j));
    await run('launchctl', ['unload', p], { cwd: ROOT });
    const r = await run('launchctl', ['load', p], { cwd: ROOT });
    notes.push(`${j.label}: ${r.code === 0 ? 'loaded' : (r.stderr || r.stdout).trim()} (${j.calendar.map((c) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][c.Weekday ?? 0]} ${String(c.Hour).padStart(2, '0')}:${String(c.Minute).padStart(2, '0')}`).join(', ')})`);
  }
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
  return JOBS.map((j) => `${j.label}: ${installed.includes(`${j.label}.plist`) ? 'installed' : 'not installed'}, ${lc.stdout.includes(j.label) ? 'loaded' : 'not loaded'}`);
}
