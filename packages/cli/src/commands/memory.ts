import { Command } from "commander";
import kleur from "kleur";
import { resolve } from "node:path";
import {
  MemoryStore,
  defaultQueuePath,
  type MemoryTier,
  type RecallDepth,
} from "@claudemax/memory";
import { formatPlanBudgetState } from "@claudemax/core";
import { detectPlan } from "@claudemax/runtime";

const VALID_TIERS: ReadonlySet<MemoryTier> = new Set([
  "episode",
  "decision",
  "pattern",
  "error-solution",
  "graph",
]);

const VALID_DEPTHS: ReadonlySet<RecallDepth> = new Set(["simple", "medium", "deep"]);

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

  cmd
    .command("recall <task>")
    .description(
      "Hybrid-scored memory recall (BM25 + entity-match + recency + verification). Depth: simple=5, medium=15, deep=50 hits. Stale rows (last verified > 30d) get a STALE flag.",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--depth <d>", "simple | medium | deep", "medium")
    .option("--lane <id>", "filter by lane_id")
    .option("--run <id>", "filter by run_id")
    .option("--no-stale", "exclude stale rows (defaults to include with flag)")
    .option("--stale-days <n>", "staleness threshold in days", "30")
    .action(
      (
        task: string,
        opts: {
          path: string;
          depth: string;
          lane?: string;
          run?: string;
          stale: boolean;
          staleDays: string;
        },
      ) => {
        const depth = opts.depth as RecallDepth;
        if (!VALID_DEPTHS.has(depth)) {
          console.error(kleur.red(`error: --depth must be one of: simple, medium, deep`));
          process.exit(2);
        }
        const m = new MemoryStore({ path: resolve(process.cwd(), opts.path) });
        const hits = m.recall(task, {
          depth,
          includeStale: opts.stale !== false,
          staleAfterDays: Number(opts.staleDays),
          scope: { laneId: opts.lane, runId: opts.run },
        });
        m.close();
        if (!hits.length) {
          console.log(kleur.dim(`(no memory hits for "${task}" at depth=${depth})`));
          return;
        }
        const grouped = new Map<string, typeof hits[number][]>();
        for (const h of hits) {
          const arr = grouped.get(h.source) ?? [];
          arr.push(h);
          grouped.set(h.source, arr);
        }
        console.log(
          kleur.bold(`recall "${task}"`) +
            kleur.dim(` · depth=${depth} · ${hits.length} hit(s)\n`),
        );
        for (const [source, group] of grouped) {
          console.log(kleur.cyan(`# ${source}  (${group.length})`));
          for (const h of group) {
            const tag = h.stale ? kleur.yellow(" [STALE]") : "";
            const ver =
              h.verifiedCount > 0
                ? kleur.dim(` ✓${h.verifiedCount}`)
                : "";
            const scope = [h.laneId, h.runId].filter(Boolean).join(" · ");
            const scopeStr = scope ? kleur.dim(` {${scope}}`) : "";
            console.log(
              `  ${kleur.bold(`#${h.rowidRef}`)} ${h.title}${tag}${ver}${scopeStr} ${kleur.dim(
                `score=${h.score.toFixed(2)} ts=${h.ts}`,
              )}`,
            );
            console.log(`    ${kleur.dim(h.snippet)}`);
          }
        }
      },
    );

  cmd
    .command("add <tier> <content>")
    .description(
      "Append durable memory. Tier: episode | decision | pattern | error-solution | graph (CoALA taxonomy).",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--title <t>", "explicit title (defaults to first 80 chars of content)")
    .option("--tags <csv>", "comma-separated tags")
    .option("--lane <id>", "lane_id")
    .option("--run <id>", "run_id")
    .option("--user <id>", "user_id")
    .option("--app <id>", "app_id")
    .action(
      (
        tier: string,
        content: string,
        opts: {
          path: string;
          title?: string;
          tags?: string;
          lane?: string;
          run?: string;
          user?: string;
          app?: string;
        },
      ) => {
        if (!VALID_TIERS.has(tier as MemoryTier)) {
          console.error(
            kleur.red(
              `error: tier must be one of: episode, decision, pattern, error-solution, graph`,
            ),
          );
          process.exit(2);
        }
        const title = opts.title ?? content.slice(0, 80);
        const m = new MemoryStore({ path: resolve(process.cwd(), opts.path) });
        const result = m.add(tier as MemoryTier, title, content, {
          tags: opts.tags ? opts.tags.split(",").map((t) => t.trim()) : undefined,
          laneId: opts.lane,
          runId: opts.run,
          userId: opts.user,
          appId: opts.app,
        });
        m.close();
        console.log(
          kleur.green(`  added ${tier} → ${result.source}#${result.rowidRef}: ${title}`),
        );
      },
    );

  cmd
    .command("verify <ref>")
    .description(
      "Mark a memory row as still-valid (refreshes last_verified_at, bumps verified_count). Ref format: source#id (e.g. decisions#42).",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--by <who>", "audit-trail attribution (e.g. agent name)")
    .action((ref: string, opts: { path: string; by?: string }) => {
      const match = ref.match(/^([a-z_]+)#(\d+)$/);
      if (!match) {
        console.error(kleur.red(`error: ref must look like source#id (e.g. decisions#42)`));
        process.exit(2);
      }
      const source = match[1]!;
      const rowidRef = Number(match[2]);
      const m = new MemoryStore({ path: resolve(process.cwd(), opts.path) });
      const ok = m.markVerified(source, rowidRef, opts.by);
      m.close();
      if (!ok) {
        console.error(kleur.red(`error: no row found at ${ref}`));
        process.exit(1);
      }
      console.log(kleur.green(`  verified ${ref}` + (opts.by ? ` (by ${opts.by})` : "")));
    });

  cmd
    .command("drain")
    .description(
      "Drain the async JSONL write queue into SQLite. Run as a cron tick or on session end.",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .option("--queue <path>", "queue path (defaults to .claudemax/memory.queue.jsonl)")
    .action((opts: { path: string; queue?: string }) => {
      const m = new MemoryStore({ path: resolve(process.cwd(), opts.path) });
      const queuePath = opts.queue
        ? resolve(process.cwd(), opts.queue)
        : defaultQueuePath(process.cwd());
      const n = m.drainQueue(queuePath);
      m.close();
      console.log(n > 0 ? kleur.green(`  drained ${n} envelope(s)`) : kleur.dim("  (queue empty)"));
    });

  return cmd;
}
