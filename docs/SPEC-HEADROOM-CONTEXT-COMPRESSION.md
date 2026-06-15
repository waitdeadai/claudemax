# SPEC — Context Compression across the four harnesses (headroom: integrate vs. inspire)

**Status:** proposed (spec-driven; Phase 1 e2e'd on openmax 2026-06-15)
**Provenance:** `/deepresearch` 2026-06-15 (sources in §Evidence). Subject repo: [chopratejas/headroom](https://github.com/chopratejas/headroom) — "compress tool outputs, logs, files, RAG chunks before they reach the LLM; library + proxy + MCP."
**Harnesses:** claudemax (this repo), openmax (`~/Documents/openmax`), plumb (`~/Music/harness/plumb`), openplumb (fork).

---

## 1. Evidence (dated, cited)

- **headroom is real but its docs benchmarks are extraction/log-shaped, not agentic.** Overall **66.1%** compression @ ~5ms; JSON arrays 70–90% (SmartCrusher), logs 80–95% (LogCompressor), search 60–80%, code 40–70% (CodeCompressor, AST-aware, *collapses bodies / preserves signatures*), plain text 30–50% (Kompress = ModernBERT token-classification, **ML/non-deterministic**). Accuracy shown only on HTML extraction (F1 0.919) + JSON-log QA (F1 0.85→0.87). **No tool-calling/agentic benchmark in the docs** — the README's BFCL/GSM8K numbers are not substantiated on the benchmarks page. `headroom-docs.vercel.app/docs/benchmarks` (accessed 2026-06-15).
- **CCR (Compress-Cache-Retrieve)** is headroom's best idea: compression is *reversible* — originals cached, model pulls them back via `headroom_retrieve`. This is the safety primitive worth stealing. `headroom-docs.vercel.app/docs` (accessed 2026-06-15).
- **Integration surface:** transparent proxy (`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL=localhost:8787`), Python lib, TS lib (`headroom-ai`), MCP (`headroom_compress/retrieve/stats`), `headroom wrap claude`. Runtime: Python 3.10+ / Rust / ONNX + HuggingFace model fetched at runtime. **No documented per-path disable or no-compress marker** — a real gap for our verify-firewall requirement.
- **Lossy compression is an attack surface (decisive constraint).** *CompressionAttack* (arXiv [2510.22963](https://arxiv.org/html/2510.22963v2), accessed 2026-06-15): HardCom reaches up to **80% ASR** on Selective Context / 62% on LLMLingua, **98% preference-flip**, validated on real VSCode Cline + Ollama agents. Even **un-attacked** lossy compression drops clean-baseline accuracy to 13–19% on their task; tested defenses detect <5%. Compression sits upstream of inference with no safety alignment.
- **SOTA prompt compression** = LLMLingua / LLMLingua-2 (ModernBERT token-classify, distilled) / LongLLMLingua (question-aware, position-bias), SemanticZip, RECOMP, Selective Context — up to 20× but "code requires different compression than prose." [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua); [morphllm 2026 guide](https://www.morphllm.com/prompt-compression) (accessed 2026-06-15).
- **Anthropic ships the native equivalent for the Claude side.** Memory tool (`memory_20250818`, client-side `/memories`, just-in-time retrieval; SDK helpers `betaMemoryTool` (TS) / `BetaAbstractMemoryTool` (Py)), **context editing** (rule-based tool-result clearing), **compaction** (server-side summarization near the window limit). Framing: context as a finite "attention budget," **context rot** = more tokens → worse recall. [Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool); [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (accessed 2026-06-15).

**Open questions:** headroom's agentic accuracy is unmeasured by them — must be measured on our own traces; the deterministic crushers (JSON/log) vs. the ML Kompress have very different risk; whether Claude Code exposes context-editing config through the Agent SDK `query()` surface we use.

---

## 2. Cross-cutting invariants (apply to ALL harnesses)

1. **VERIFY-FIREWALL (hard).** No compression — lossy *or* structural — may touch the blind-verify, grounding, evidence (`EVIDENCE:`/`STATUS:`), or `searchoclock` error-text path. Justified by CompressionAttack + blind-verify integrity. Enforced by a test per harness.
2. **REVERSIBLE-OR-NOTHING.** Any compression must be CCR-style: original retained, recoverable by a `retrieve(handle)` call. Nothing irrecoverable enters the context.
3. **DETERMINISTIC-FIRST.** Prefer deterministic structural reduction (JSON-array fold, log dedupe, search-result rank) over the ML token-classifier. ML compression is opt-in, off by default, and never on code or evidence.
4. **EFFECTIVENESS FRAMING, not cost.** The win we claim is context-rot avoidance + rate-limit headroom (subscription) / signal density — never "cheaper." (claudemax identity rule.)
5. **READ-ONLY SCOPE.** Compression runs only on read/exploration tool outputs (file reads, search, logs), never on writes, diffs, or anything the model must reproduce verbatim.

---

## 3. Per-harness plan

### openmax — INTEGRATE (Phase 1, e2e now)
- **Why:** OpenRouter is pay-per-token (real savings) + provider-plural + its OpenAI-compatible path matches headroom's proxy.
- **Build:** `@openmax/context-digest` — deterministic, dependency-light TS digester (JSON-array fold, log dedupe, search rank) with a CCR cache + `retrieve(handle)`. Wire into the runtime read-tool path only. Optional `OPENAI_BASE_URL` proxy passthrough (lets a user point at a real headroom proxy) documented in README. Telemetry: a `digest stats` line in `openmax doctor`.
- **Completion conditions (verifyHints):**
  - `pnpm build && pnpm typecheck && pnpm test` green.
  - Test: digester is **bypassed** on the verify/grounding path (`grep` the runtime wiring + an assertion test).
  - Test: `retrieve()` losslessly recovers the original for every digested payload.
  - Test: ML/lossy mode is off unless explicitly enabled; code payloads are never compressed.
  - `openmax doctor` prints digest layer status + cumulative tokens saved.

### claudemax — ADOPT NATIVE, do NOT bundle (Phase 2, human-gated)
- **Why:** Anthropic-native primitives (memory tool + context editing + compaction) already deliver the value via the Agent SDK we use, ZDR-safe, no Python/Rust sidecar, no CompressionAttack surface on code/evidence. Bundling headroom would violate lean-catalog + minimal-MCP + Anthropic-only + effectiveness-not-cost.
- **Build (gated — touches identity surfaces; requires human bless per repo rules):** enable the memory tool + context editing on long-running `query()` calls (orchestrator, /goal, overnight, loop) with the verify/grounding tools excluded from clearing; a small in-repo deterministic tool-output digester (same idea as openmax's, ported) on read tools only. NO router change, NO new skill, NO new bundled MCP.
- **Completion conditions:** memory tool + context editing enabled on the long-running drivers with a test proving verify-path tool results are never cleared; `pnpm build/typecheck/test` green; cc-audit-style note recorded.

### plumb / openplumb — INSPIRE, never bundle (Phase 3)
- **Why:** zero-dependency, determinism-first, AI-reluctant. An ML compressor with model downloads is the antithesis of plumb. But the *goal* (shrink what reaches the LLM) is exactly plumb's mission.
- **Build:** a **rung-0 deterministic context reducer** — a zero-dep, lossless-with-pointer structural fold (JSON/logs) that runs *before* the ladder, so less reaches even rung 1. Must be lossless + reversible (keep original, pass digest + handle). This *lowers* `llmShare()`-relevant token pressure deterministically, on-ethos. No `headroom-ai`, no ONNX, no network.
- **Completion conditions:** `npm test`/`typecheck` green; reducer is provably lossless (round-trip test); zero new runtime deps preserved; `solve()` semantics unchanged; reducer never runs on the verify gate.

---

## 4. Phasing
- **Phase 1 (now, e2e):** openmax `@openmax/context-digest` — clear yes, own repo, low risk.
- **Phase 2 (human-gated):** claudemax native context-engineering adoption — identity surfaces, discuss before editing.
- **Phase 3:** plumb/openplumb rung-0 deterministic reducer — additive, on-ethos, after Phase 1 proves the digester design.

## 5. Explicitly rejected
- Bundling the headroom product (Python/Rust sidecar + runtime model download) into any of the four repos.
- Any lossy ML compression on code, diffs, evidence, or the verify path.
- Framing any of this as a cost-saving feature in claudemax.
