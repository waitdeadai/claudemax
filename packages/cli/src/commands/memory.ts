import { Command } from "commander";
import kleur from "kleur";
import { resolve } from "node:path";
import { MemoryStore } from "@claudemax/memory";
import { formatPlanBudgetState } from "@claudemax/core";
import { detectPlan } from "@claudemax/runtime";

export function memoryCommand(): Command {
  const cmd = new Command("memory").description("Persistent memory inspection");

  cmd
    .command("search <query>")
    .description("FTS5 search across episodes, decisions, errors, patterns, runs")
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--limit <n>", "max results", "20")
    .action((q: string, opts: { path: string; limit: string }) => {
      const m = new MemoryStore({ path: resolve(process.cwd(), opts.path) });
      const hits = m.search(q, Number(opts.limit));
      m.close();
      if (!hits.length) {
        console.log(kleur.dim("(no hits)"));
        return;
      }
      for (const h of hits) {
        console.log(
          `${kleur.cyan(h.source)}#${h.rowidRef}  ${kleur.bold(h.title)}\n  ${kleur.dim(h.snippet)}\n`,
        );
      }
    });

  cmd
    .command("runs")
    .description("List recent runs")
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--limit <n>", "max results", "10")
    .action((opts: { path: string; limit: string }) => {
      const m = new MemoryStore({ path: resolve(process.cwd(), opts.path) });
      const rows = m.recentRuns(Number(opts.limit));
      m.close();
      for (const r of rows) {
        const sc = r.status === "finished" ? kleur.green : kleur.yellow;
        console.log(
          `${kleur.dim(r.ts)}  ${sc(r.status.padEnd(9))}  $${r.costUsd.toFixed(2).padStart(6)}  ${r.specTitle}`,
        );
      }
    });

  cmd
    .command("credit")
    .description("Show monthly Agent SDK credit consumption + cache hit rate")
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .action(({ path }: { path: string }) => {
      const m = new MemoryStore({ path: resolve(process.cwd(), path) });
      let consumed: number, cache: ReturnType<MemoryStore["cacheStatsThisPeriod"]>;
      try {
        consumed = m.creditConsumedThisPeriod();
        cache = m.cacheStatsThisPeriod();
      } finally {
        m.close();
      }
      const plan = detectPlan();
      console.log(kleur.bold("monthly Agent SDK credit (this billing window)"));
      console.log(`  ${formatPlanBudgetState(plan.plan, consumed)}`);
      console.log(kleur.dim(`  source: ${plan.source}`));
      console.log(kleur.bold("\nprompt cache (this period)"));
      console.log(`  hit rate:        ${cache.hitRatePct.toFixed(1)}%`);
      console.log(`  read tokens:     ${cache.cacheReadTokens.toLocaleString()}`);
      console.log(`  write tokens:    ${cache.cacheWriteTokens.toLocaleString()}`);
      console.log(`  total input:     ${cache.totalInputTokens.toLocaleString()}`);
      if (cache.hitRatePct < 30 && cache.totalInputTokens > 100_000) {
        console.log(
          kleur.yellow(
            "  hint: hit rate < 30% on > 100k input tokens. Either workload is genuinely cold, or you may be hitting SDK caching bug https://github.com/anthropics/claude-agent-sdk-typescript/issues/188.",
          ),
        );
      }
    });

  return cmd;
}
