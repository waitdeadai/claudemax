import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoopAction, LoopVerdict } from "@claudemax/core";

// The dedup ledger for standing-loops (docs/LOOP_MODE_PLAN.md §6B). A recurring,
// input-driven loop MUST NOT re-ship work it already did — idempotency is a
// correctness requirement, not a nicety. Each acted-on work item is recorded by
// its stable key; the next tick skips any key already present.

export interface LedgerEntry {
  readonly key: string; // workItemKey() — stable identity of the unit of work
  readonly title: string;
  readonly source: string;
  readonly verdict: LoopVerdict;
  readonly action: LoopAction; // the converge-loop's final action for this item
  readonly creditUsd: number;
  readonly ts: string;
}

export interface LoopLedger {
  readonly name: string;
  readonly entries: readonly LedgerEntry[];
}

export function loopStateDir(cwd: string, name: string, stateDir?: string): string {
  return stateDir ?? join(cwd, ".claudemax", "state", "loop", slug(name));
}

function ledgerPath(cwd: string, name: string, stateDir?: string): string {
  return join(loopStateDir(cwd, name, stateDir), "ledger.json");
}

export function loadLedger(cwd: string, name: string, stateDir?: string): LoopLedger {
  const path = ledgerPath(cwd, name, stateDir);
  if (!existsSync(path)) return { name, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LoopLedger;
    return { name, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    // A corrupt ledger must not silently erase dedup memory and cause re-shipping.
    // Surface it loudly and start empty only for THIS read.
    process.stderr.write(`  [loop] warning: ledger for '${name}' is unreadable — treating as empty this tick\n`);
    return { name, entries: [] };
  }
}

export function saveLedger(cwd: string, ledger: LoopLedger, stateDir?: string): void {
  const dir = loopStateDir(cwd, ledger.name, stateDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerPath(cwd, ledger.name, stateDir), JSON.stringify(ledger, null, 2), "utf8");
}

export function ledgerKeys(ledger: LoopLedger): ReadonlySet<string> {
  return new Set(ledger.entries.map((e) => e.key));
}

export function appendLedger(
  cwd: string,
  name: string,
  entry: LedgerEntry,
  stateDir?: string,
): LoopLedger {
  const current = loadLedger(cwd, name, stateDir);
  const next: LoopLedger = { name, entries: [...current.entries, entry] };
  saveLedger(cwd, next, stateDir);
  return next;
}

// Sum credit recorded across EVERY standing-loop's ledger under .claudemax/state/loop.
// This is the fleet's cumulative spend — the input to the fleet-level budget guard
// that the dozens-of-loops reality makes non-negotiable (the $47K-runaway lesson).
export function fleetLedgerSpendUsd(cwd: string): number {
  const root = join(cwd, ".claudemax", "state", "loop");
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const dirent of safeReaddir(root)) {
    if (!dirent.isDirectory()) continue;
    const path = join(root, dirent.name, "ledger.json");
    if (!existsSync(path)) continue;
    try {
      const led = JSON.parse(readFileSync(path, "utf8")) as LoopLedger;
      for (const e of led.entries ?? []) total += Number(e.creditUsd) || 0;
    } catch {
      // ignore an unreadable ledger for the fleet total
    }
  }
  return total;
}

function safeReaddir(dir: string): { name: string; isDirectory: () => boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
