import pLimit from 'p-limit';

export { pLimit };

/** Serialise work per key (e.g. per domain) while allowing different keys to run in parallel. */
export function keyedLock() {
  const chains = new Map<string, Promise<unknown>>();
  return async function withKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(key, next.catch(() => undefined));
    try {
      return await next;
    } finally {
      if (chains.get(key) === next) chains.delete(key);
    }
  };
}
