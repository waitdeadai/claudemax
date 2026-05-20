import { Command } from "commander";
import kleur from "kleur";
import { resolve } from "node:path";
import { deepResearch } from "@claudemax/runtime";
import { MemoryStore } from "@claudemax/memory";

export function researchCommand(): Command {
  return new Command("research")
    .description("/deepresearch a topic. Prints brief; persists sources to memory.research_sources")
    .argument("<topic>", "research topic in quotes")
    .option("--max-sources <n>", "cap on sources", "12")
    .option("--memory <path>", "memory db path", ".claudemax/memory.sqlite")
    .action(async (topic: string, opts: { maxSources: string; memory: string }) => {
      console.log(kleur.cyan(`→ deepresearch: ${topic}`));
      const brief = await deepResearch(topic, {
        cwd: process.cwd(),
        maxSources: Number(opts.maxSources),
      });

      console.log(kleur.bold(`\nsummary`));
      console.log(brief.summary);

      console.log(kleur.bold(`\nkey findings`));
      for (const f of brief.keyFindings) console.log(`  - ${f}`);

      console.log(kleur.bold(`\nsources (${brief.sources.length})`));
      for (const s of brief.sources) {
        console.log(`  ${kleur.cyan(s.relevance.toFixed(2))}  ${kleur.bold(s.title)}`);
        console.log(`    ${kleur.dim(s.url)}`);
      }

      if (brief.openQuestions.length) {
        console.log(kleur.bold(`\nopen questions`));
        for (const q of brief.openQuestions) console.log(`  - ${q}`);
      }

      const m = new MemoryStore({ path: resolve(process.cwd(), opts.memory) });
      for (const s of brief.sources) {
        m.recordResearchSource({
          topic: brief.topic,
          url: s.url,
          title: s.title,
          publishedAt: s.publishedAt,
          relevance: s.relevance,
          excerpt: s.excerpt,
        });
      }
      m.close();
      console.log(kleur.dim(`\n→ ${brief.sources.length} sources persisted to ${opts.memory}`));
    });
}
