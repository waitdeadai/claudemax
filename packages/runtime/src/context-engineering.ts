// Single source of truth for Anthropic-native context engineering configuration.
// All builders are OFF by default — they return undefined or empty values unless
// explicitly opted in via CMAX_CONTEXT_ENGINEERING=1|true or opts.enabled=true.

export type ProtectedContextKind = "verify" | "grounding" | "evidence";

export const PROTECTED_CONTEXT_KINDS: readonly ProtectedContextKind[] = [
  "verify",
  "grounding",
  "evidence",
];

export function isProtectedContext(kind: string): kind is ProtectedContextKind {
  return (PROTECTED_CONTEXT_KINDS as readonly string[]).includes(kind);
}

// mcp__memory__* tools are the canonical grounding tool set (never clear them).
// Verify-bearing and evidence-bearing tool names are matched by substring.
export function isProtectedToolName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.startsWith("mcp__memory__")) return true;
  if (name.includes("verify")) return true;
  if (name.includes("evidence")) return true;
  return false;
}

const CONTEXT_ENGINEERING_ENV = "CMAX_CONTEXT_ENGINEERING";

export function readContextEngineeringEnv(): boolean {
  const v = process.env[CONTEXT_ENGINEERING_ENV];
  return v === "1" || v === "true";
}

export function contextEngineeringEnabled(): boolean {
  return readContextEngineeringEnv();
}

export const MEMORY_TOOL_BETA = "memory_20250818";

// Grounding tools that must never be cleared during context-editing passes.
// Mirrors MEMORY_MCP_TOOLS from sdk-options.ts — kept local here to avoid a
// circular import between the two modules. Update both lists in lockstep.
const GROUNDING_TOOLS = [
  "mcp__memory__memory_search",
  "mcp__memory__memory_get_decision",
  "mcp__memory__memory_get_fact",
  "mcp__memory__memory_stale",
] as const;

const GROUNDING_SET = new Set<string>(GROUNDING_TOOLS);

export interface MemoryToolOpts {
  readonly enabled?: boolean;
  readonly memoryPath?: string;
}

// Returns the beta string(s) to merge into the betas array when opted in.
// Returns an empty array when not opted in — callers spread this into betas, so
// an empty return is a safe no-op and preserves backward compatibility with
// sdk-options.ts which does `betas.push(...buildMemoryToolConfig())`.
export function buildMemoryToolConfig(opts?: MemoryToolOpts): readonly string[] {
  const enabled =
    opts !== undefined
      ? (opts.enabled ?? readContextEngineeringEnv())
      : readContextEngineeringEnv();
  return enabled ? [MEMORY_TOOL_BETA] : [];
}

// Shape of a tool-result descriptor the SDK passes to the shouldDigest predicate.
export interface ToolResultDescriptor {
  readonly toolName?: string;
  readonly result?: string;
}

// Mutation tools whose outputs must never be digested regardless of context kind.
const MUTATION_TOOLS = new Set<string>(["Write", "Edit", "Bash"]);

// Explicit allowlist of safe exploration tools whose results can be digested.
// Unknown tools (Agent, custom MCPs, etc.) default to protected (return false) to
// prevent accidental loss of non-read-only output under context compression.
const EXPLORATION_TOOLS = new Set<string>(["Read", "Glob", "Grep"]);

// Predicate for the SDK context-editing pass: returns true only for
// exploration/read tool results that are safe to compress.
// Grounding tools (mcp__memory__*), mutation tools (Write/Edit/Bash), results
// whose content starts with "EVIDENCE:", and any unknown/unnamed tool are all
// protected (return false). Only explicitly-listed exploration tools return true.
export function contextShouldDigest(toolResult: ToolResultDescriptor): boolean {
  const name = toolResult?.toolName ?? "";
  const result = toolResult?.result ?? "";
  if (!name) return false;
  if (GROUNDING_SET.has(name)) return false;
  if (MUTATION_TOOLS.has(name)) return false;
  if (result.trimStart().startsWith("EVIDENCE:")) return false;
  return EXPLORATION_TOOLS.has(name);
}

// The full protected-tools list carried through the loop's ceOpts signal.
// Mirrors GROUNDING_TOOLS — kept in sync manually (see comment on GROUNDING_TOOLS).
export const CE_PROTECTED_TOOLS: readonly string[] = [...GROUNDING_TOOLS];

// Opts object threaded as the 3rd argument of ConvergeLoopOptions.iterateFn.
// Tests capture it to assert which protections are active; the default iterate
// closure uses it to enable contextEngineering: true in the runGoal call.
// verifyFn never receives this — verify is always excluded from CE.
export interface LoopContextEngineeringOpts {
  readonly memoryPath: string;
  readonly protectedTools: readonly string[];
}

export interface ContextEditingOpts {
  readonly enabled?: boolean;
  readonly extraExclude?: readonly string[];
}

// Returns the SDK context_management block when opted in, undefined otherwise.
//
// Accepts ContextEditingOpts (new opt-in API) or a legacy string contextKind tag
// (backward-compatible with existing sdk-options.ts call sites that pass o.contextKind).
// All paths gate on CMAX_CONTEXT_ENGINEERING env or opts.enabled.
//
// Legacy (string/undefined) path returns the edit.protected structure the existing
// sdk-options.ts tests assert. The opts-object path returns the newer
// context_management.clear_tool_uses.exclude structure.
export function buildContextEditingConfig(
  opts?: ContextEditingOpts | string,
): Record<string, unknown> | undefined {
  if (typeof opts === "string") {
    // Legacy call from sdk-options.ts: buildContextEditingConfig(o.contextKind)
    if (!readContextEngineeringEnv()) return undefined;
    return {
      edit: {
        shouldDigest: contextShouldDigest,
        protected: [...GROUNDING_TOOLS],
      },
    };
  }

  if (opts === undefined) {
    // No-arg or bare undefined: gate by env.
    if (!readContextEngineeringEnv()) return undefined;
    return {
      edit: {
        shouldDigest: contextShouldDigest,
        protected: [...GROUNDING_TOOLS],
      },
    };
  }

  // New opts-object API.
  const enabled = opts.enabled ?? readContextEngineeringEnv();
  if (!enabled) return undefined;
  const exclude = [...GROUNDING_TOOLS, ...(opts.extraExclude ?? [])];
  return {
    context_management: {
      clear_tool_uses: {
        exclude,
      },
    },
  };
}
