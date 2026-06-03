import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InteractiveVerifyHint } from "@claudemax/core";

export interface InteractiveVerifyResult {
  readonly tool: InteractiveVerifyHint["tool"];
  readonly met: boolean;
  readonly evidence: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface RunInteractiveOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export async function runInteractiveVerify(
  hint: InteractiveVerifyHint,
  opts: RunInteractiveOptions = {},
): Promise<InteractiveVerifyResult> {
  const cwd = opts.cwd ?? process.cwd();
  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  const timeoutMs = hint.timeoutMs ?? 120_000;

  switch (hint.tool) {
    case "playwright":
      return runPlaywrightScript(hint.script, hint.expect, { cwd, env, timeoutMs });
    case "browser":
      return runPlaywrightScript(hint.script, hint.expect, { cwd, env, timeoutMs });
    case "shell":
      return runShell(hint.script, hint.expect, { cwd, env, timeoutMs });
  }
}

interface RunCtx {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

async function runPlaywrightScript(
  script: string,
  expect: string | undefined,
  ctx: RunCtx,
): Promise<InteractiveVerifyResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "claudemax-pw-"));
  const scriptPath = join(tmpDir, "verify.mjs");
  writeFileSync(scriptPath, script, "utf8");
  const started = Date.now();
  const r = await execCapture("node", [scriptPath], ctx);
  const durationMs = Date.now() - started;
  const combined = `${r.stdout}\n${r.stderr}`;
  const ev = evaluateExpect(expect, combined, r.exitCode);
  return {
    tool: "playwright",
    met: ev.met,
    evidence: `playwright ${ev.evidence}`,
    exitCode: r.exitCode,
    durationMs,
    stdoutTail: tail(r.stdout, 2000),
    stderrTail: tail(r.stderr, 2000),
  };
}

async function runShell(
  script: string,
  expect: string | undefined,
  ctx: RunCtx,
): Promise<InteractiveVerifyResult> {
  const started = Date.now();
  const r = await execCapture("bash", ["-c", script], ctx);
  const durationMs = Date.now() - started;
  const combined = `${r.stdout}\n${r.stderr}`;
  const ev = evaluateExpect(expect, combined, r.exitCode);
  return {
    tool: "shell",
    met: ev.met,
    evidence: `shell ${ev.evidence}`,
    exitCode: r.exitCode,
    durationMs,
    stdoutTail: tail(r.stdout, 2000),
    stderrTail: tail(r.stderr, 2000),
  };
}

// ── Tolerant `expect` evaluation ──────────────────────────────────────────
// The interactive `expect` field is routinely authored as a NATURAL-LANGUAGE
// description of success ("EXIT=0 with no failing tests and at least 11 passing")
// rather than a literal output token. The original check required the ENTIRE
// `expect` string to be a substring of stdout+stderr, which produced systematic
// FALSE NEGATIVES: the command exits 0 and prints the real sentinels (EXIT=0,
// "# fail 0", "ok 5"), yet the prose never appears verbatim, so met flipped to
// false (surfacing as failureCategory "interactive-failure" — see verify.ts).
// We instead:
//   • take the MECHANICAL success signal from an echoed `EXIT=<n>` sentinel when
//     present (the `; echo EXIT=$?` idiom masks the real process exit to 0), else
//     from the real process exit code;
//   • treat `expect` as CORROBORATION, never a prose veto — a literal substring
//     or all extractable salient tokens (TAP counters, ok/not-ok lines, quoted
//     literals) must be present to corroborate; pure prose with no checkable
//     token is advisory and never vetoes.
// A genuine failure (echoed EXIT!=0, real non-zero exit, or "# fail 3" when the
// expect demanded "# fail 0") still yields met=false.
export function extractSalientTokens(expect: string): string[] {
  const tokens = new Set<string>();
  const patterns = [
    /#\s*(?:tests|pass|fail|cancelled|skipped|todo)\s+\d+/gi, // cmax-allow: TAP counter field names, not a TODO marker
    /\bnot ok\s+\d+/gi,
    /\bok\s+\d+/gi,
  ];
  for (const re of patterns) {
    for (const m of expect.matchAll(re)) tokens.add(m[0].replace(/\s+/g, " ").trim());
  }
  for (const re of [/"([^"]{2,})"/g, /`([^`]{2,})`/g]) {
    for (const m of expect.matchAll(re)) if (m[1]) tokens.add(m[1].trim());
  }
  return [...tokens];
}

export function evaluateExpect(
  expect: string | undefined,
  combined: string,
  exitCode: number | null,
): { met: boolean; evidence: string } {
  const echoed = /EXIT\s*=\s*(\d+)/i.exec(combined);
  const mechanicalOk = echoed ? echoed[1] === "0" : exitCode === 0;
  const mechSignal = echoed ? `echoed EXIT=${echoed[1]}` : `exit=${exitCode}`;

  if (!expect) {
    return { met: mechanicalOk, evidence: `${mechSignal}, no expect` };
  }
  if (combined.includes(expect)) {
    return { met: mechanicalOk, evidence: `${mechSignal}, expect matched literally` };
  }
  // A short single-token sentinel (no whitespace, identifier-like) was meant to
  // appear verbatim — its absence is a genuine failure, not unmatchable prose.
  const trimmed = expect.trim();
  if (trimmed.length > 0 && !/\s/.test(trimmed)) {
    return { met: false, evidence: `${mechSignal}, literal expect not found in output: "${trimmed}"` };
  }
  const tokens = extractSalientTokens(expect);
  if (tokens.length) {
    const missing = tokens.filter((t) => !combined.includes(t));
    return {
      met: mechanicalOk && missing.length === 0,
      evidence:
        missing.length === 0
          ? `${mechSignal}, salient expect tokens [${tokens.join(", ")}] present`
          : `${mechSignal}, salient expect tokens absent: [${missing.join(", ")}]`,
    };
  }
  // Pure prose expect — not machine-checkable; trust the mechanical signal and
  // mark the prose advisory (never veto a genuinely-clean run on unmatched prose).
  return {
    met: mechanicalOk,
    evidence: `${mechSignal}, prose expect not literally present (advisory; not vetoed)`,
  };
}

interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function execCapture(cmd: string, args: readonly string[], ctx: RunCtx): Promise<ExecResult> {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { cwd: ctx.cwd, env: ctx.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolveP({ exitCode: null, stdout: stdout + "\n[killed: timeout]", stderr });
    }, ctx.timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ exitCode: code, stdout, stderr });
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ exitCode: null, stdout, stderr: stderr + `\n[spawn error: ${err.message}]` });
    });
  });
}

function tail(s: string, n: number): string {
  return s.length > n ? s.slice(s.length - n) : s;
}
