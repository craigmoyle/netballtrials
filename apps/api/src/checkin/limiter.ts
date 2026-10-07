export type PinLimiter = {
  allow(key: string, now: Date): boolean;
  fail(key: string, now: Date): void;
  reset(key: string): void;
};

export function createPinLimiter(options: { max: number; windowMs: number }): PinLimiter {
  const entries = new Map<string, { count: number; windowStart: number }>();

  function current(key: string, now: Date) {
    const entry = entries.get(key);
    if (!entry || now.getTime() - entry.windowStart >= options.windowMs) {
      return null;
    }
    return entry;
  }

  return {
    allow(key, now) {
      const entry = current(key, now);
      return !entry || entry.count < options.max;
    },
    fail(key, now) {
      const entry = current(key, now);
      if (!entry) {
        entries.set(key, { count: 1, windowStart: now.getTime() });
        return;
      }
      entry.count += 1;
    },
    reset(key) {
      entries.delete(key);
    },
  };
}
