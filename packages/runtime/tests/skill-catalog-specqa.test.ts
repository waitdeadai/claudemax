import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const catalogPath = join(repoRoot, "docs", "SKILL_CATALOG.md");

function readCatalog(): string {
  return readFileSync(catalogPath, "utf8");
}

function planningSection(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const isH2 = line.startsWith("## ");
    if (isH2) {
      inside = /^##\s+.*[Pp]lanning/.test(line);
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join("\n");
}

describe("docs/SKILL_CATALOG.md /specqa entry", () => {
  it("references /specqa somewhere in the catalog", () => {
    expect(readCatalog()).toMatch(/specqa/);
  });

  it("places /specqa under a Planning-labeled heading", () => {
    expect(planningSection(readCatalog())).toMatch(/specqa/);
  });

  it("contains no duplicate /specqa rows", () => {
    const rows = readCatalog()
      .split("\n")
      .filter((line) => /^\|\s*`?\/specqa/.test(line));
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
