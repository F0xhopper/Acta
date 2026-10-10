/** The automation switches in config/build.yaml (`automation`): the daily sweep, the Sunday auto-picker, the web email search and the autopilot. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT } from '../config.js';

export interface Automation { sweep: boolean; autoPick: boolean; webEmail: boolean; autopilot: boolean }
export type AutomationKey = 'sweep' | 'auto_pick' | 'web_email' | 'autopilot';

export function loadAutomation(): Automation {
  try {
    const raw = parseYaml(readFileSync(join(ROOT, 'config', 'build.yaml'), 'utf8')) as { automation?: { sweep?: boolean; auto_pick?: boolean; web_email?: boolean; autopilot?: boolean } };
    return { sweep: raw.automation?.sweep === true, autoPick: raw.automation?.auto_pick === true, webEmail: raw.automation?.web_email !== false, autopilot: raw.automation?.autopilot === true };
  } catch { return { sweep: false, autoPick: false, webEmail: true, autopilot: false }; }
}

export const OFF_HINT = 'It is switched off in config/build.yaml (automation). Search from the Leads page and pick by hand, or set it to true to bring it back.';

/** Flip one `automation` switch in the YAML text, touching only that line so the comments stay. Pure; throws when the line is missing. */
export function flipFlag(text: string, key: AutomationKey, on: boolean): string {
  const re = new RegExp(`^(automation:[ \\t]*\\n(?:[ \\t]+#.*\\n|[ \\t]+\\w+:.*\\n)*?[ \\t]+${key}:[ \\t]*)(true|false)`, 'm');
  if (!re.test(text)) throw new Error(`config/build.yaml has no automation.${key} line to change`);
  return text.replace(re, `$1${on}`);
}

/** Switch one automation on or off in config/build.yaml. */
export function setAutomation(key: AutomationKey, on: boolean): Automation {
  const p = join(ROOT, 'config', 'build.yaml');
  writeFileSync(p, flipFlag(readFileSync(p, 'utf8'), key, on));
  return loadAutomation();
}

/** Switch automatic lead finding on or off. */
export const setSweep = (on: boolean) => setAutomation('sweep', on);
