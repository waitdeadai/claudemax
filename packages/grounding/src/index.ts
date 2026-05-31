export { migrate, resolveDbPath } from "./migrate.js";
export type { MigrateResult } from "./migrate.js";

export { compileVault } from "./compile-vault.js";
export type { CompileVaultOptions, CompileVaultResult } from "./compile-vault.js";

export { exportVault } from "./export-vault.js";
export type { ExportVaultOptions, ExportVaultResult } from "./export-vault.js";

export { compileClaudeMd } from "./compile-claudemd.js";
export type { CompileClaudeMdOptions, CompileClaudeMdResult } from "./compile-claudemd.js";

export { parseFrontmatter, serializeNote } from "./frontmatter.js";
export type { FrontmatterValue, ParsedNote } from "./frontmatter.js";

import { compileVault, type CompileVaultOptions, type CompileVaultResult } from "./compile-vault.js";
import {
  compileClaudeMd,
  type CompileClaudeMdOptions,
  type CompileClaudeMdResult,
} from "./compile-claudemd.js";
import { exportVault as exportVaultImpl } from "./export-vault.js";

export interface CompileResult {
  readonly vault: CompileVaultResult;
  readonly claudeMd: CompileClaudeMdResult;
}

// `cmax ground compile` — vault → sqlite (promote blessed) → CLAUDE.md managed
// block, in that order so the block reflects the just-compiled accepted rows.
export function compile(
  opts: CompileVaultOptions & CompileClaudeMdOptions = {},
): CompileResult {
  const vault = compileVault(opts);
  const claudeMd = compileClaudeMd(opts);
  return { vault, claudeMd };
}

// `cmax ground export` — proposed rows lacking vault provenance → vault/_inbox/.
export { exportVaultImpl as export };
