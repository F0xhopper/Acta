/** Whether the automatic sweep and the auto-picker are switched on (config/build.yaml, `automation`). Both default to off. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from '../config.js';

export interface Automation { sweep: boolean; autoPick: boolean }

export function loadAutomation(): Automation {
  try {
    const raw = parseYaml(readFileSync(join(ROOT, 'config', 'build.yaml'), 'utf8')) as { automation?: { sweep?: boolean; auto_pick?: boolean } };
    return { sweep: raw.automation?.sweep === true, autoPick: raw.automation?.auto_pick === true };
  } catch { return { sweep: false, autoPick: false }; }
}

export const OFF_HINT = 'It is switched off in config/build.yaml (automation). Search from the Leads page and pick by hand, or set it to true to bring it back.';
