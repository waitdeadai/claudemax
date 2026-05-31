import { Command } from "commander";
import kleur from "kleur";
import { resolve } from "node:path";
import { compile, exportVault, migrate } from "@claudemax/grounding";

export function groundCommand(): Command {
  const cmd = new Command("ground").description(
    "Grounding layer: migrate the schema, compile blessed vault notes into memory + CLAUDE.md, export proposed rows for review.",
  );

  cmd
    .command("migrate")
    .description(
      "Idempotently apply the grounding schema (creates project_facts, adds the decisions columns). Safe to run repeatedly.",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .action((opts: { path: string }) => {
      const result = migrate(resolve(process.cwd(), opts.path));
      console.log(kleur.green(`  migrated ${result.path}`));
      console.log(
        `  project_facts: ${result.hasProjectFacts ? kleur.green("present") : kleur.red("missing")}`,
      );
      console.log(kleur.dim(`  decisions columns: ${result.decisionColumns.join(", ")}`));
    });

  cmd
    .command("compile")
    .description(
      "Promote blessed vault notes → accepted memory rows, then compile invariant=1 rows into the CLAUDE.md managed block.",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .action((opts: { path: string }) => {
      const dbPath = resolve(process.cwd(), opts.path);
      const result = compile({ dbPath });
      console.log(
        kleur.green(
          `  vault → memory: ${result.vault.decisionsAccepted} decision(s), ${result.vault.factsAccepted} fact(s) accepted` +
            (result.vault.superseded ? `, ${result.vault.superseded} superseded` : "") +
            (result.vault.skipped ? `, ${result.vault.skipped} skipped (not blessed)` : ""),
        ),
      );
      if (result.claudeMd.filesWritten.length) {
        for (const f of result.claudeMd.filesWritten) {
          console.log(kleur.green(`  compiled CLAUDE.md block → ${f}`));
        }
      } else {
        console.log(kleur.dim("  no invariant rows to compile into CLAUDE.md"));
      }
    });

  cmd
    .command("export")
    .description(
      "Write proposed rows that have no vault provenance into vault/_inbox/ (blessed:false) for human review.",
    )
    .option("--path <path>", "memory db path", ".claudemax/memory.sqlite")
    .action((opts: { path: string }) => {
      const dbPath = resolve(process.cwd(), opts.path);
      const result = exportVault({ dbPath });
      if (result.written.length) {
        console.log(kleur.green(`  exported ${result.written.length} proposed row(s) → vault/_inbox/`));
        for (const f of result.written) console.log(kleur.dim(`    ${f}`));
      } else {
        console.log(kleur.dim("  no proposed rows pending review"));
      }
    });

  return cmd;
}
