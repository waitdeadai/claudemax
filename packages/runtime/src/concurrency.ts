// Bounded-parallel runner + per-task wall-clock timeout. Shared by the decomposed
// verifier (verify.ts) and the adversarial verifier (mutation-verify.ts); lives in
// its own module so neither has to import the other.

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Race a factory against a wall-clock timeout. On timeout the AbortSignal fires
// (so a query() call can cancel) and onTimeout() supplies the default-FAIL result.
// The factory is expected not to reject (the per-condition runner catches its own
// errors); a rejection is treated like a timeout for safety.
export function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  const ac = new AbortController();
  return new Promise<T>((resolveP) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
      resolveP(onTimeout());
    }, ms);
    factory(ac.signal).then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveP(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveP(onTimeout());
      },
    );
  });
}
