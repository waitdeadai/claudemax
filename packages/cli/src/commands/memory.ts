import { Command } from "commander";
import kleur from "kleur";
import { resolve } from "node:path";
import { MemoryStore } from "@claudemax/memory";

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

  return cmd;
}
