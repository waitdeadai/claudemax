import { Command } from "commander";
import kleur from "kleur";
import {
  HAIKU_MODEL_ID,
  judgeWithHaiku,
  type JudgeInput,
  type JudgeVerdict,
} from "@claudemax/runtime";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function fallbackVerdict(reason: string): JudgeVerdict {
  return {
    action: "LOG",
    reason,
    confidence: 0,
    tier: "fallback",
    latencyMs: 0,
    model: HAIKU_MODEL_ID,
  };
}

function parsePayload(raw: string): JudgeInput | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "empty payload (provide JSON on stdin or via --payload)" };
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `invalid JSON: ${msg}` };
  }
  if (!obj || typeof obj !== "object") {
    return { error: "payload must be a JSON object" };
  }
  const o = obj as Record<string, unknown>;
  if (typeof o["content"] !== "string") {
    return { error: 'payload missing required string field "content"' };
  }
  const input: JudgeInput = {
    content: o["content"],
    ...(typeof o["context"] === "string" ? { context: o["context"] } : {}),
    ...(typeof o["hookName"] === "string" ? { hookName: o["hookName"] } : {}),
    ...(Array.isArray(o["categories"])
      ? { categories: (o["categories"] as unknown[]).filter((x): x is string => typeof x === "string") }
      : {}),
  };
  return input;
}

export function verdictJudgeCommand(): Command {
  return new Command("verdict-judge")
    .description(
      "Tier-3 Haiku judge: read JSON payload from stdin (or --payload), print verdict JSON to stdout. Exit 0 always.",
    )
    .option("--payload <json>", "JSON payload string (alternative to stdin)")
    .action(async (opts: { payload?: string }) => {
      const raw = opts.payload ?? (await readStdin());
      const parsed = parsePayload(raw);
      let verdict: JudgeVerdict;
      if ("error" in parsed) {
        process.stderr.write(kleur.dim(`verdict-judge: ${parsed.error}\n`));
        verdict = fallbackVerdict(`invalid payload: ${parsed.error}`);
      } else {
        process.stderr.write(kleur.dim(`verdict-judge: invoking haiku...\n`));
        verdict = await judgeWithHaiku(parsed);
        process.stderr.write(
          kleur.dim(
            `verdict-judge: tier=${verdict.tier} action=${verdict.action} latency=${verdict.latencyMs}ms\n`,
          ),
        );
      }
      process.stdout.write(`${JSON.stringify(verdict)}\n`);
      process.exit(0);
    });
}
