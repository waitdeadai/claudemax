// Hook introspection helpers for `cmax doctor --hooks`. Pure TS strict; the
// only I/O is fs (settings JSON) and child_process (locating + versioning the
// agentcloseout-physics binary). No SDK calls, no network.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOOK_EVENTS = [
  "Stop",
  "PostToolUse",
  "PreToolUse",
  "UserPromptSubmit",
  "SubagentStop",
  "SessionStart",
  "PreCompact",
  "PostCompact",
  "Notification",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookHandler {
  readonly type?: string;
  readonly command?: string;
  readonly url?: string;
  readonly [key: string]: unknown;
}

export interface HookSourceEntry {
  readonly source: string;
  readonly event: HookEvent;
  readonly matcher: string;
  readonly handler: HookHandler;
}

export interface ReadHookSourcesOptions {
  readonly userPath?: string;
  readonly repoPath?: string;
  readonly cwd?: string;
}

interface MatcherBlock {
  readonly matcher?: unknown;
  readonly hooks?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadSettings(source: string): Record<string, unknown> | null {
  if (!existsSync(source)) return null;
  let raw: string;
  try {
    raw = readFileSync(source, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isObject(parsed) ? parsed : null;
}

export function readHookSources(opts: ReadHookSourcesOptions = {}): HookSourceEntry[] {
  const userPath = opts.userPath ?? join(homedir(), ".claude", "settings.json");
  const cwd = opts.cwd ?? process.cwd();
  const repoPath = opts.repoPath ?? join(cwd, ".claude", "settings.json");
  const out: HookSourceEntry[] = [];
  for (const source of [userPath, repoPath]) {
    const settings = loadSettings(source);
    if (!settings) continue;
    const hooks = settings["hooks"];
    if (!isObject(hooks)) continue;
    for (const event of HOOK_EVENTS) {
      const blocks = hooks[event];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!isObject(block)) continue;
        const b = block as MatcherBlock;
        const matcher = typeof b.matcher === "string" && b.matcher.length > 0 ? b.matcher : "*";
        const handlers = b.hooks;
        if (!Array.isArray(handlers)) continue;
        for (const handler of handlers) {
          if (!isObject(handler)) continue;
          out.push({ source, event, matcher, handler: handler as HookHandler });
        }
      }
    }
  }
  return out;
}

export function detectMisconfiguredHook(
  entry: HookHandler | HookSourceEntry | { handler?: HookHandler },
): string | null {
  const handler: HookHandler | undefined =
    isObject(entry) && "handler" in entry && isObject((entry as { handler?: unknown }).handler)
      ? ((entry as { handler: HookHandler }).handler)
      : (entry as HookHandler);
  if (!isObject(handler)) return "missing handler object";
  if (typeof handler.type !== "string" || handler.type.length === 0) {
    return "missing type (expected 'command' or 'http')";
  }
  if (handler.type === "command") {
    if (typeof handler.command !== "string" || handler.command.length === 0) {
      return "type=command requires a non-empty command";
    }
    return null;
  }
  if (handler.type === "http") {
    if (typeof handler.url !== "string" || handler.url.length === 0) {
      return "type=http requires a non-empty url";
    }
    return null;
  }
  return `unknown type: ${handler.type}`;
}

export interface ProbeResult {
  readonly path: string | null;
  readonly version: string | null;
  readonly error?: string;
}

export function probeAgentcloseoutPhysics(): ProbeResult {
  let path: string | null = null;
  let version: string | null = null;
  let error: string | undefined;
  try {
    const out = execFileSync("which", ["agentcloseout-physics"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    if (trimmed.length > 0) path = trimmed;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (path) {
    try {
      const v = execFileSync("agentcloseout-physics", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      version = v.trim();
      error = undefined;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return error !== undefined ? { path, version, error } : { path, version };
}
