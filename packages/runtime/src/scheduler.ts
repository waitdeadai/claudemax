// claudemax scheduler — SOTA-2026 systemd-user-timer wrapper with auto PATH
// discovery, reset-aware retry, dry-fire validation, and persistent state.
//
// Root causes this module exists to make impossible (per 2026-05-22 overnight
// failure post-mortem):
//   (1) systemd user units inherit a minimal PATH that does NOT include
//       nvm's node bin dir, so any cmax command spawned from a transient
//       unit dies with `env: «node»: not found`. Fix: discover the full
//       interactive-shell PATH at install time and bake into Environment=.
//   (2) systemd OnCalendar= rejects ISO-8601 with T-separator and TZ
//       suffix. `2026-05-22T05:47:17-03:00` -> "Invalid argument".
//       Fix: convert to `YYYY-MM-DD HH:MM:SS` (no T, no TZ).
//   (3) No dry-fire = night lost. Fix: simulate the systemd minimal env +
//       run the target command BEFORE arming the timer; abort if it fails.
//
// Sources (all accessed 2026-05-22):
//   - docs.anthropic.com/en/api/rate-limits — RFC3339 ratelimit-*-reset headers
//   - github.com/cheapestinference/claude-auto-retry — canonical retry pattern
//   - github.com/jshchnz/claude-code-scheduler — wrapper + system-scheduler pattern
//   - github.com/Hexagon/croner — zero-dep cron parsing
//   - claude.com/blog/introducing-routines-in-claude-code (Apr 14 2026) —
//     cloud routines exist but are hourly-min + stateless; systemd wins for
//     minute-level + stateful overnight builds
//   - github.com/anthropics/claude-code issue #33820 — ratelimit headers not
//     exposed to hooks, so we parse stderr like saturation.ts does

import { execSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Cron } from "croner";

// ---- Types -----------------------------------------------------------------

export type ScheduleKind = "at" | "cron" | "every";

export interface ScheduleSpec {
  readonly name: string;
  readonly kind: ScheduleKind;
  readonly when: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly resumeOnLimit?: boolean;
  readonly maxIterations?: number;
  readonly logPath?: string;
  readonly description?: string;
}

export interface ScheduleState {
  readonly name: string;
  readonly kind: ScheduleKind;
  readonly when: string;
  readonly commandJson: string;
  readonly cwd: string;
  readonly createdAt: string;
  lastFireAt?: string;
  nextFireAt?: string;
  iterations: number;
  status: "armed" | "fired" | "exceeded" | "cancelled";
  systemdUnit?: string;
  logPath?: string;
}

// ---- PATH discovery (root cause 1 fix) -------------------------------------

// Resolve a PATH suitable for an unattended systemd user unit. Strategy:
//   1. Start with the invoking process's PATH (which is the interactive
//      shell's PATH if cmax is invoked from a terminal).
//   2. Auto-discover the actual `node` binary directory via `command -v node`
//      run inside the user's login shell (catches nvm-managed installs
//      where `node` is symlinked through a versioned dir).
//   3. Add canonical bin dirs that often hold cmax dependencies: ~/.local/bin
//      ~/.cargo/bin, /usr/local/bin, etc.
//   4. Deduplicate, preserving order (earlier wins).
//
// Returns the PATH string to put in the systemd unit's Environment=PATH=
// directive. NOT the same as just `process.env.PATH` because that may be
// the Claude Code agent's PATH, not the user's real shell PATH.
export function discoverFullPath(): string {
  const parts: string[] = [];

  // 1. Current process PATH
  if (process.env["PATH"]) parts.push(...process.env["PATH"].split(":"));

  // 2. Auto-discover node bin dir via login shell (handles nvm).
  try {
    const out = execSync("bash -lc 'command -v node 2>/dev/null'", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (out) {
      const nodeBinDir = dirname(out);
      parts.unshift(nodeBinDir);
    }
  } catch {
    // Login shell unavailable (e.g. in unit tests) — skip; the existing
    // PATH may already cover it.
  }

  // 3. Canonical user bin dirs.
  const home = homedir();
  const canonical = [
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin"),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  for (const p of canonical) parts.push(p);

  // 4. Dedupe preserving order.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    deduped.push(t);
  }
  return deduped.join(":");
}

// ---- Calendar format conversion (root cause 2 fix) -------------------------

// Convert a Date / ISO timestamp / "YYYY-MM-DD HH:MM:SS" string into
// systemd's OnCalendar= compatible "YYYY-MM-DD HH:MM:SS" form.
//
// systemd-analyze calendar rejects:
//   - ISO 8601 with T separator: "2026-05-22T05:47:17"
//   - Any timezone suffix:       "2026-05-22 05:47:17-03:00"
//   - Sub-second precision:      "2026-05-22 05:47:17.123"
//
// And accepts:
//   - "2026-05-22 05:47:17"        (one-shot in local time)
//   - "*-*-* 05:47:00"             (every day at 05:47)
//   - "Mon..Fri 09:00"             (weekdays at 9am)
export function toSystemdCalendar(when: Date | string): string {
  if (when instanceof Date) {
    return formatLocalDateForSystemd(when);
  }
  const s = when.trim();
  // Already in systemd recurring form (contains wildcards or weekday names)
  if (/^[*A-Za-z]/.test(s)) return s;
  // Try parsing as ISO/Date string
  const d = new Date(s);
  if (!isNaN(d.getTime())) return formatLocalDateForSystemd(d);
  // Hand it through; let systemd reject if malformed (caller can catch).
  return s;
}

function formatLocalDateForSystemd(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// Parse a cron expression via croner; return the next fire time as a Date.
// Used for `--cron` schedules where we want to validate the expression
// before handing to systemd's OnCalendar (which has a different but
// largely-compatible syntax).
export function nextFireFromCron(expression: string, from: Date = new Date()): Date | null {
  try {
    const c = new Cron(expression);
    const next = c.nextRun(from);
    return next ?? null;
  } catch {
    return null;
  }
}

// ---- Reset-time parsing (claude-auto-retry pattern) ------------------------

// Patterns confirmed against live Anthropic CLI output (2026-05-21 session):
//   "You've hit your session limit · resets 3pm (America/Argentina/Mendoza)"
//   "You've hit your limit · resets 9:30pm (America/Argentina/Mendoza)"
//   "rate-limit: resets at 2026-05-22T05:30:00Z"  (RFC3339, less common)
//   "5-hour limit reached - resets 3pm"
//
// Returns the next Date the limit resets, or null if no pattern matched.
export function parseResetTime(text: string, now: Date = new Date()): Date | null {
  // 1. RFC3339 form (best signal — what anthropic-ratelimit-*-reset headers
  //    would carry if they were exposed to hooks per anthropics/claude-code #33820).
  //    Capture fractional seconds AND require the timezone suffix so the
  //    parsed Date is unambiguous (without a TZ suffix, JS Date interprets
  //    the bare timestamp as LOCAL time, which silently corrupts the offset).
  const rfc = text.match(
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/,
  );
  if (rfc) {
    const d = new Date(rfc[1]!);
    if (!isNaN(d.getTime()) && d.getTime() > now.getTime()) return d;
  }

  // 2. Human-readable form: "resets 3pm" / "resets 9:30pm" / "resets at 2am"
  const human = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (human) {
    const hour12 = parseInt(human[1]!, 10);
    const minutes = human[2] ? parseInt(human[2], 10) : 0;
    const ampm = human[3]!.toLowerCase();
    const hour24 = ampm === "p" ? (hour12 % 12) + 12 : hour12 % 12;
    const candidate = new Date(now);
    candidate.setHours(hour24, minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      // Past today — assume next occurrence is tomorrow.
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  return null;
}

// Add a safety margin (default 30s) and return ISO string.
export function withSafetyMargin(reset: Date, safetySeconds = 30): Date {
  return new Date(reset.getTime() + safetySeconds * 1000);
}

// The three observed Anthropic throttle signals — callers should treat these as
// pause-and-resume, NOT a logic failure. Single source of truth shared by the
// mega lane dispatcher and the run-pipeline interrupt handler:
//   (1) burst protection: "temporarily limiting requests (not your usage limit)"
//   (2) Max subscription pool: "You've hit your session limit · resets <Xpm>"
//   (3) generic: rate-limit / 429 / exceeded / saturation / usage limit
const SATURATION_RE =
  /session limit|temporarily limiting requests|rate.?limit|429|exceeded|saturation|usage limit|resets \d+\s*[ap]m/i;

export function isSaturationSignal(text: string): boolean {
  return SATURATION_RE.test(text);
}

// ---- Dry-fire validation (root cause 3 fix) --------------------------------

// Validate that `command` can execute under the EXACT minimal env the
// systemd user unit will inject. If this fails, the timer fire would fail
// too — abort before arming.
//
// Returns { ok, exitCode, stderr, simulatedPath } for caller-side handling.
export interface DryFireResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stderr: string;
  readonly simulatedPath: string;
}

export function dryFire(
  command: readonly string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string>> = {},
): DryFireResult {
  const fullPath = discoverFullPath();
  // Simulate systemd's minimal env: clear everything, set only what the
  // unit will set. This mirrors `systemd-run --user --pipe --wait -E PATH=...`.
  const minimalEnv: Record<string, string> = {
    HOME: homedir(),
    USER: process.env["USER"] ?? "",
    LOGNAME: process.env["LOGNAME"] ?? process.env["USER"] ?? "",
    SHELL: "/bin/bash",
    PATH: fullPath,
    LANG: process.env["LANG"] ?? "C.UTF-8",
    ...extraEnv,
  };
  // Use --help (or --version) instead of the full command for dry-fire — we
  // only want to confirm the binary is reachable + parses its own args.
  const probe = [command[0]!, "--help"];
  const r = spawnSync(probe[0]!, probe.slice(1), {
    cwd,
    env: minimalEnv,
    encoding: "utf8",
    timeout: 10_000,
  });
  return {
    ok: r.status === 0,
    exitCode: r.status ?? -1,
    stderr: r.stderr ?? "",
    simulatedPath: fullPath,
  };
}

// ---- systemd unit generation -----------------------------------------------

// Generate the systemd-run --user invocation that arms a timer for `spec`.
// Returns the argv we'd hand to `spawnSync` (or print for inspection).
export function buildSystemdRunArgs(
  spec: ScheduleSpec,
  wrapperPath: string,
  pathEnv: string,
): readonly string[] {
  const unit = systemdUnitName(spec.name);
  const calendarArg =
    spec.kind === "cron" ? spec.when : toSystemdCalendar(spec.when);
  return [
    "systemd-run",
    "--user",
    `--unit=${unit}.service`,
    `--on-calendar=${calendarArg}`,
    `--description=${spec.description ?? `cmax schedule: ${spec.name}`}`,
    `--setenv=PATH=${pathEnv}`,
    ...(spec.env
      ? Object.entries(spec.env).map(([k, v]) => `--setenv=${k}=${v}`)
      : []),
    "--working-directory",
    spec.cwd,
    "/bin/bash",
    wrapperPath,
  ];
}

export function systemdUnitName(name: string): string {
  // Allowed: [A-Za-z0-9_.\-]+ ; map other chars to '-'.
  return `cmax-sched-${name.replace(/[^A-Za-z0-9_.\-]/g, "-")}`;
}

// ---- Wrapper script (reset-aware retry) ------------------------------------

// Generate the bash wrapper systemd-run will execute. The wrapper:
//   1. Logs start timestamp.
//   2. Runs the target command, capturing stdout+stderr.
//   3. On non-zero exit, scans output for rate-limit reset patterns.
//   4. If reset time parseable AND resumeOnLimit, schedules a follow-up
//      systemd-run timer for `reset + safetySeconds` to retry.
//   5. Updates the schedule state JSON.
export function buildWrapperScript(args: {
  readonly spec: ScheduleSpec;
  readonly stateDir: string;
  readonly logPath: string;
  readonly pathEnv: string;
}): string {
  const { spec, stateDir, logPath, pathEnv } = args;
  const statePath = join(stateDir, `${spec.name}.json`);
  const cmdShell = spec.command
    .map((c) => `'${c.replace(/'/g, "'\\''")}'`)
    .join(" ");
  return `#!/usr/bin/env bash
# Auto-generated by cmax schedule (claudemax/runtime/scheduler.ts).
# Wraps the user-supplied command with reset-aware retry + state update.
set -uo pipefail

export PATH="${pathEnv}"
LOG="${logPath}"
STATE="${statePath}"
NAME="${spec.name}"
RESUME_ON_LIMIT="${spec.resumeOnLimit ? "1" : "0"}"
MAX_ITER="${spec.maxIterations ?? 0}"

ts() { date -Iseconds; }
log() { printf '%s  %s\\n' "$(ts)" "$*" >> "$LOG"; }

mkdir -p "$(dirname "$LOG")"

log ""
log "================================================================"
log "cmax schedule '$NAME' FIRED"
log "================================================================"
log "cwd: $(pwd)"
log "cmd: ${cmdShell}"

# Update state: lastFireAt + iterations++
python3 - <<'PY' || true
import json, datetime, sys
state_path = "${statePath}"
try:
    with open(state_path) as f:
        s = json.load(f)
    s["lastFireAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    s["iterations"] = int(s.get("iterations", 0)) + 1
    s["status"] = "fired"
    with open(state_path, "w") as f:
        json.dump(s, f, indent=2)
except Exception as e:
    print(f"state update failed: {e}", file=sys.stderr)
PY

# Capture output for rate-limit pattern scanning.
TMPOUT=$(mktemp)
${cmdShell} > >(tee -a "$TMPOUT" >> "$LOG") 2> >(tee -a "$TMPOUT" >> "$LOG" >&2)
EXIT=$?
log "exit=$EXIT"

# Reset-aware retry: scan output for "session limit ... resets <X>" or
# RFC3339 timestamps. If found AND resumeOnLimit, schedule a follow-up.
if [ "$EXIT" -ne 0 ] && [ "$RESUME_ON_LIMIT" = "1" ]; then
  RESET_TXT=$(tail -200 "$TMPOUT" 2>/dev/null | grep -oE '(resets? (at )?[0-9]+(:[0-9]+)?\\s*[ap]\\.?m\\.?|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:?[0-9]{2})?)' | head -1)
  if [ -n "$RESET_TXT" ]; then
    log "rate-limit reset detected: '$RESET_TXT'"
    # Compute the follow-up calendar string via cmax (which has our parser).
    if command -v cmax >/dev/null 2>&1; then
      NEXT_CAL=$(cmax schedule parse-reset "$RESET_TXT" 2>/dev/null || true)
      if [ -n "$NEXT_CAL" ]; then
        log "rescheduling next fire for $NEXT_CAL"
        systemd-run --user \\
          --unit="cmax-sched-${spec.name}-retry-\${RANDOM}.service" \\
          --on-calendar="$NEXT_CAL" \\
          --setenv="PATH=${pathEnv}" \\
          --working-directory="${spec.cwd}" \\
          /bin/bash "$0" >> "$LOG" 2>&1 || log "  follow-up systemd-run failed"
      fi
    fi
  fi
fi

rm -f "$TMPOUT"
log "wrapper done"
exit "$EXIT"
`;
}

// ---- Persistent state ------------------------------------------------------

export function scheduleStateDir(cwd: string): string {
  return join(cwd, ".claudemax", "scheduled");
}

export function writeScheduleState(cwd: string, state: ScheduleState): void {
  const dir = scheduleStateDir(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${state.name}.json`);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

export function readScheduleState(cwd: string, name: string): ScheduleState | null {
  const path = join(scheduleStateDir(cwd), `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ScheduleState;
  } catch {
    return null;
  }
}

export function listScheduleStates(cwd: string): readonly ScheduleState[] {
  const dir = scheduleStateDir(cwd);
  if (!existsSync(dir)) return [];
  const out: ScheduleState[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as ScheduleState);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function deleteScheduleState(cwd: string, name: string): boolean {
  const path = join(scheduleStateDir(cwd), `${name}.json`);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

// ---- Wrapper writer (combines everything) ----------------------------------

export interface ArmResult {
  readonly state: ScheduleState;
  readonly wrapperPath: string;
  readonly systemdArgs: readonly string[];
  readonly pathEnv: string;
}

export function prepareArm(spec: ScheduleSpec): ArmResult {
  if (platform() !== "linux") {
    throw new Error(
      `cmax schedule currently supports Linux (systemd user units). Detected: ${platform()}. For mac/Windows, use cron / launchctl / schtasks directly until cross-platform driver lands.`,
    );
  }

  const cwd = resolve(spec.cwd);
  const stateDir = scheduleStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });

  const pathEnv = discoverFullPath();
  const logPath = spec.logPath ?? join(stateDir, `${spec.name}.log`);
  mkdirSync(dirname(logPath), { recursive: true });

  const wrapperPath = join(stateDir, `${spec.name}.wrapper.sh`);
  const wrapperScript = buildWrapperScript({ spec, stateDir, logPath, pathEnv });
  writeFileSync(wrapperPath, wrapperScript, "utf8");
  chmodSync(wrapperPath, 0o755);

  const systemdArgs = buildSystemdRunArgs(spec, wrapperPath, pathEnv);

  const next =
    spec.kind === "cron"
      ? nextFireFromCron(spec.when)
      : spec.kind === "at"
        ? new Date(spec.when)
        : null;

  const state: ScheduleState = {
    name: spec.name,
    kind: spec.kind,
    when: spec.when,
    commandJson: JSON.stringify(spec.command),
    cwd,
    createdAt: new Date().toISOString(),
    nextFireAt: next ? next.toISOString() : undefined,
    iterations: 0,
    status: "armed",
    systemdUnit: `${systemdUnitName(spec.name)}.service`,
    logPath,
  };
  writeScheduleState(cwd, state);

  return { state, wrapperPath, systemdArgs, pathEnv };
}

// Append a line to a schedule's log (used by CLI when arming/cancelling).
export function logScheduleEvent(logPath: string, line: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()}  ${line}\n`, "utf8");
}
