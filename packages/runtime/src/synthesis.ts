// Decomposed map-reduce synthesis (§4-bis).
//
// Every fan-in — rollup verify, the /deepresearch condenser, any merge — must
// combine pre-condensed BRIEFS hierarchically, never re-ingest all raw context
// into one window (that synchronous fan-in is exactly what stalls the condenser).
// These are the reusable primitives: a tree reduce where no stage ever sees more
// than `groupSize` inputs at once, plus dedup for overlapping briefs.

export function dedupeBy<T>(items: readonly T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = keyFn(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

// Tree reduce: merge items in bounded groups, then merge the merges, until one
// remains. The reducer only ever sees a group of size <= max(2, groupSize), so no
// single step holds all raw input — the anti-stall property. A group of size 1
// passes through untouched (no needless reducer call).
export async function hierarchicalMerge<T>(
  items: readonly T[],
  groupSize: number,
  reducer: (group: readonly T[]) => Promise<T> | T,
): Promise<T> {
  if (items.length === 0) throw new Error("hierarchicalMerge: no items to merge");
  const g = Math.max(2, Math.trunc(groupSize) || 2);
  let level: T[] = [...items];
  while (level.length > 1) {
    const next: T[] = [];
    for (let i = 0; i < level.length; i += g) {
      const group = level.slice(i, i + g);
      next.push(group.length === 1 ? group[0]! : await reducer(group));
    }
    level = next;
  }
  return level[0]!;
}
