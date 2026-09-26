let verbose = false;
export function setVerbose(v: boolean) { verbose = v; }

const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`${ts()} ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`${ts()} WARN ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`${ts()} ERROR ${msg}`, ...rest),
  debug: (msg: string, ...rest: unknown[]) => { if (verbose) console.log(`${ts()} .. ${msg}`, ...rest); },
};
