# CC / artifact audit log

Dated audits of upstream Claude Code releases and third-party artifacts proposed for the claudemax harness. Methodology: `/cc-audit` (anchor date → primary sources → cross-check → IGNORE/WRAP/INTEGRATE/DEFER → record).

---

## Feature audit — Anthropic-native context engineering (memory tool + context editing) — 2026-06-15

**Subject:** Phase 2 of `docs/SPEC-HEADROOM-CONTEXT-COMPRESSION.md` — adopt Anthropic's native context-engineering primitives on claudemax's long-running drivers instead of bundling the third-party `headroom` product (Python/Rust/ONNX sidecar). Branch: `feat/native-context-engineering`.

**Primary sources verified (accessed 2026-06-15):**
- Memory tool (`memory_20250818`, client-side `/memories`, just-in-time retrieval; TS `betaMemoryTool` / Py `BetaAbstractMemoryTool`) — https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Context editing (rule-based tool-result clearing) + compaction (server-side summarization near the window limit) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents ; https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Counter-evidence on lossy compression as attack surface: *CompressionAttack* arXiv [2510.22963](https://arxiv.org/html/2510.22963v2) (HardCom ≤80% ASR on Selective Context, 98% preference-flip; un-attacked lossy compression drops clean accuracy to 13–19%).

**Verdict: ADOPT NATIVE, do NOT bundle (= INTEGRATE the native primitives; IGNORE the headroom product).**
- Native memory tool + context editing deliver the headroom value (context-rot avoidance, attention-budget headroom) via the Agent SDK `query()` surface we already use — ZDR-safe, no sidecar, no runtime model download, no CompressionAttack surface on code/evidence.
- Bundling headroom would violate four repo invariants at once: lean-catalog, minimal-MCP, Anthropic-only, effectiveness-not-cost.

**What shipped (this branch — all OFF by default, gated on `CMAX_CONTEXT_ENGINEERING=1|true` or `opts.enabled`):**
- `packages/runtime/src/context-engineering.ts` — single source of truth: `buildMemoryToolConfig` (merges `memory_20250818` beta), `buildContextEditingConfig` (`context_management` block), `contextShouldDigest` predicate, `isProtectedToolName`/`isProtectedContext`, `CE_PROTECTED_TOOLS`.
- `packages/runtime/src/read-digest.ts` — reversible CCR codec (`cmx_digest:v1:` zlib/base64), round-trip lossless. CCR = the one headroom idea worth stealing (compression is reversible; original recoverable).
- Threaded as `contextEngineering?: boolean` through all six long-running drivers (goal, orchestrator, overnight, pipeline-loop, standing-loop, loop) → sdk-options `contextEditing` + `memoryTool`.

**Invariants enforced by test (119 new tests across 4 files, all green):**
- **VERIFY-FIREWALL** — `verifyFn` is called with `spec` only; it never receives `ceOpts` (`loop-context-engineering.test.ts`). Verify/grounding/evidence tool results are never digested or cleared.
- **REVERSIBLE-OR-NOTHING** — `read-digest.test.ts` round-trips every payload losslessly.
- **DETERMINISTIC-FIRST / READ-ONLY-SCOPE** — only `Read`/`Glob`/`Grep` are digestible; `mcp__memory__*`, `Write`/`Edit`/`Bash`, and `EVIDENCE:`-prefixed results are protected; unknown tools default to protected.
- No router change, no new skill, no new bundled MCP, no new runtime deps, no bare `@anthropic-ai/sdk`. `pnpm typecheck/build/test` green (458 runtime + 8 CLI).

**Known follow-up (does NOT block Phase-2 wiring; flagged for the human bless before the flag is flipped in production):** two completeness gaps, both unobservable while the feature is OFF by default:
- **Shape mismatch:** the live-wired path (`sdk-options.ts` → `buildContextEditingConfig(o.contextKind)`, the string/legacy path) emits `context_management: { edit: { shouldDigest: <fn>, protected: [...] } }`. The `shouldDigest` callback and `protected` key are claudemax-internal, not the documented Anthropic `context_management.clear_tool_uses.exclude` API shape (which `buildContextEditingConfig`'s opts-object path produces but sdk-options does not yet call). A JS function is not JSON-serializable to the API; enabling `CMAX_CONTEXT_ENGINEERING=1` without first reconciling the emitted shape would most likely be a silent no-op.
- **Unwired codec:** the reversible CCR codec (`read-digest.ts`, `digestReadOutput`/`undigestReadOutput`) is implemented and round-trip-tested but has **no live production call site** — it is not yet attached to any read-tool output path. It is sound dead code today.

Both are confirmed by an independent blind verify (2026-06-15, OVERALL: PASS — they are completeness/correctness-when-enabled gaps, not falsifications of any stated completion condition, since the feature is OFF by default and the verify-firewall is enforced at both test and code level). Validate against a live `query()` call and wire the codec before any production enablement.

---

## Artifact audit — leaked "CLAUDE-FABLE-5.md" system prompt — 2026-06-14

**Artifact:** `elder-plinius/CL4R1T4S` → `ANTHROPIC/CLAUDE-FABLE-5.md` (raw fetched 2026-06-14, 1,585 lines / 120,040 chars). A leaked/extracted purported Fable 5 production system prompt.

**Primary sources verified:**
- https://platform.claude.com/docs/en/release-notes/system-prompts — Anthropic's OFFICIAL published `claude.ai` system prompts; latest entry **Claude Fable 5, dated 2026-06-09** (accessed 2026-06-14).
- Anthropic does NOT officially publish the tool-layer / Claude Code system prompts.

**Provenance cross-check:**
| Leaked claim | Corroboration | Verdict |
|---|---|---|
| "Mythos-class tier above Opus" identity line | matches official system-prompts page verbatim | CORROBORATED |
| Copyright rules (15-word/one-quote-per-source) | not on any Anthropic primary; only a 2nd extraction repo | UNVERIFIED |
| Tool-scaling 1 / 3–5 / 5–10 | not on any Anthropic primary; 2nd extraction repo only | UNVERIFIED |
| `/mnt/user-data` paths, `window.storage` | not on any Anthropic primary | UNVERIFIED / likely product-internal |

**Empirical A/B** (Opus 4.8 + leaked prompt = treatment vs Opus 4.8 + neutral = control; 5 probes; blind clean-Opus judge, randomized A/B; real Fable 5 NOT callable so fidelity to actual Fable-5 outputs is unverifiable):
- **Style:** leaked prompt reliably suppresses markdown — headers control→treatment `10→0` (DNS), `3→0` (tool-scaling); bullets `8→0`, `5→0`. Reproduced. = the documented Fable-5 "minimal formatting / conversational" trait.
- **Effectiveness:** blind judge **control 3 wins / 2 ties / treatment 0 wins**; helpfulness control `5/5/5/5/5` vs treatment `4/4/5/5/4`. Markdown suppression *hurt* scannability on reference answers. No over-refusal either arm.
- **Redundancy:** copyright-refusal and sensible tool-budget reasoning are already native to baseline Opus 4.8 (control matched them) — the leaked rules add no capability.

**Verdict: IGNORE** (do not integrate the artifact).
- Provenance: only the identity layer is primary-verified; the tool-layer (the only part with reusable patterns) is officially unconfirmable. IP/ToS + staleness concerns for an Anthropic-native, subscription-first repo.
- Empirics: no effectiveness upside on Opus 4.8 (0 wins); style shift is neutral-to-negative for the harness's technical/reference output.

**One narrow WRAP nugget (separate work, NOT this artifact):** the "plain-prose, no-markdown, warm, concise" register the prompt induces is the *correct* register for **WhatsApp chat outputs** (e.g. rotiseria customer replies — headers/bullets are wrong in chat). That is a ~3-line style directive authored in-house, not a 120k-char import.

**Third-party signal investigated:**
| Claim | Source | Corroborated? | Verdict |
|---|---|---|---|
| "leaked Fable-5 prompt worth integrating into the harness" | community chatter / CL4R1T4S | NO (provenance partial; no empirical upside) | IGNORE |
