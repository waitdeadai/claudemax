import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const skillPath = resolve(repoRoot, "skills", "specqa", "SKILL.md");

function extractFrontmatter(text: string): string {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error("no frontmatter block at top of file");
  return m[1];
}

describe("skills/specqa/SKILL.md", () => {
  it("[cc-skillmd-exists] exists on disk", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("[cc-frontmatter-name] frontmatter contains name: specqa", () => {
    const text = readFileSync(skillPath, "utf8");
    const fm = extractFrontmatter(text);
    expect(fm).toMatch(/^name:\s*specqa\s*$/m);
  });

  it("[cc-frontmatter-description] frontmatter contains non-empty description", () => {
    const text = readFileSync(skillPath, "utf8");
    const fm = extractFrontmatter(text);
    const m = fm.match(/^description:\s*(\S.*)$/m);
    expect(m).not.toBeNull();
    expect(m![1].trim().length).toBeGreaterThan(0);
  });

  it("[cc-frontmatter-allowed-tools] frontmatter contains allowed-tools field with value", () => {
    const text = readFileSync(skillPath, "utf8");
    const fm = extractFrontmatter(text);
    expect(fm).toMatch(/^allowed-tools:\s*\S/m);
  });
});
