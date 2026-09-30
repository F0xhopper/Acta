import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.js';
import { openDb } from '../db/index.js';
import { isoNow } from '../util/dates.js';
import { log } from '../util/log.js';

export function buildDir(slug: string): string {
  const d = join(DATA_DIR, 'builds', slug);
  mkdirSync(d, { recursive: true });
  return d;
}

/** One line to the terminal, one JSON line to the build log, one row in build_events. */
export function buildLogger(leadId: number, slug: string) {
  const file = join(buildDir(slug), 'build.log');
  const write = (level: 'info' | 'warn' | 'error', step: string | null, message: string) => {
    const at = isoNow();
    appendFileSync(file, JSON.stringify({ at, step, level, message }) + '\n');
    openDb().prepare('INSERT INTO build_events (lead_id, at, step, level, message) VALUES (?,?,?,?,?)').run(leadId, at, step, level, message.slice(0, 2000));
    const line = `[${slug}]${step ? ` ${step}:` : ''} ${message}`;
    if (level === 'error') log.error(line); else if (level === 'warn') log.warn(line); else log.info(line);
  };
  return {
    info: (step: string | null, m: string) => write('info', step, m),
    warn: (step: string | null, m: string) => write('warn', step, m),
    error: (step: string | null, m: string) => write('error', step, m),
    file,
  };
}
