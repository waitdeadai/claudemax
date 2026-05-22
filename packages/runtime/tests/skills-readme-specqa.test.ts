import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const readme = `${repoRoot}/skills/README.md`;

function bash(cmd: string) {
  return spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
}

describe("skills/README.md /specqa completion conditions (SPEC verify hints)", () => {
  it("[cc-readme-mentions-specqa] references /specqa", () => {
    const r = bash(`grep -q 'specqa' ${readme}`);
    expect(r.status).toBe(0);
  });

  it("[cc-readme-planning-row] /specqa is a row in the Planning table", () => {
    const r = bash(
      `awk '/^#+[ \\t]+[Pp]lanning/{flag=1;next} /^#+[ \\t]+/{flag=0} flag' ${readme} | grep -E '^\\|[ \\t]*\`?/?specqa'`
    );
    expect(r.status).toBe(0);
  });

  it("[cc-readme-planning-count-matches] Planning header count equals row count", () => {
    const r = bash(
      `header=$(grep -oE "Planning \\(([0-9]+)\\)" ${readme} | head -1 | grep -oE "[0-9]+"); ` +
        `rows=$(awk "/^#+[ \\t]+[Pp]lanning/{flag=1;next} /^#+[ \\t]+/{flag=0} flag" ${readme} | grep -cE "^\\|[ \\t]*\\\`?/"); ` +
        `test "$header" = "$rows"`
    );
    expect(r.status).toBe(0);
  });
});
