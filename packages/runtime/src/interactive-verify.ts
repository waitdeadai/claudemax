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
  const expectMet = expect ? combined.includes(expect) : true;
  const met = r.exitCode === 0 && expectMet;
  return {
    tool: "playwright",
    met,
    evidence: met
      ? `playwright script exit=0${expect ? ` and expect "${expect}" matched` : ""}`
      : `playwright exit=${r.exitCode}${expect && !expectMet ? `, expect "${expect}" not found in output` : ""}`,
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
  const expectMet = expect ? combined.includes(expect) : true;
  const met = r.exitCode === 0 && expectMet;
  return {
    tool: "shell",
    met,
    evidence: met
      ? `shell exit=0${expect ? ` and expect "${expect}" matched` : ""}`
      : `shell exit=${r.exitCode}${expect && !expectMet ? `, expect "${expect}" not found in output` : ""}`,
    exitCode: r.exitCode,
    durationMs,
    stdoutTail: tail(r.stdout, 2000),
    stderrTail: tail(r.stderr, 2000),
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
