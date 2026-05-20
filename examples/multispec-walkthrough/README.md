# Multispec walkthrough — "add a /health endpoint with passing tests across 3 sub-Specs"

A worked example showing what `cmax run "<goal>"` actually does end-to-end. Use this to:

- Understand the multispec pipeline before trusting it on real work
- See the expected output shape at each phase
- Decide whether your goal fits the FAT umbrella shape

## The goal

```
cmax run "add a GET /health endpoint that returns build sha and uptime; cover with one integration test; document in README"
```

## What the engine does

### Phase 1 — `/deepresearch` (Sonnet collects, Opus synthesizes)

The umbrella auto-runs deepresearch on the goal. For this scope it's lightweight (~5 sources):

- WebSearch: "express health check endpoint best practices 2026"
- WebSearch: "build sha runtime injection patterns 2026"
- WebFetch: project README + package.json

Sources persisted to `memory.research_sources` for future re-use. Output:

```
brief: { topic, summary, keyFindings: [...], sources: [...], openQuestions: [] }
```

### Phase 2 — multispec decompose (Opus)

The decomposer authors a `MultiSpec` with 3 sub-Specs and a DAG:

- `sub-1-route`: register the route handler
  - writeSet: `["src/routes/health.ts", "src/router.ts"]`
  - completion conditions:
    - `cc-route-registered`: `grep -R "/health" src/router.ts` shows route registration
    - `cc-handler-returns-200`: `curl -s localhost:3000/health` returns HTTP 200
- `sub-2-payload`: payload shape `{ ok: true, sha, uptimeMs }`
  - writeSet: `["src/routes/health.ts"]` (overlap with sub-1 → forces serial)
  - completion conditions:
    - `cc-payload-shape`: response body has `ok`, `sha`, `uptimeMs` keys with correct types
- `sub-3-test`: integration test
  - writeSet: `["src/routes/__tests__/health.test.ts"]`
  - completion conditions:
    - `cc-test-passes`: `pnpm test --filter health` exits 0
- `sub-4-docs`: README entry
  - writeSet: `["README.md"]`
  - completion conditions:
    - `cc-docs-updated`: README contains "## /health" section
- dependencies: `sub-2 ← sub-1`, `sub-3 ← sub-2`, `sub-4 ← sub-3`
- rollupCompletionConditions:
  - `cc-rollup-curl`: `curl -s localhost:3000/health | jq` returns the expected JSON
  - `cc-rollup-tests-green`: `pnpm test` overall is green (no regression)

**Mode selection**: 4 sub-Specs, overlap on `src/routes/health.ts` between sub-1 and sub-2 → engine picks **Mode B (Agent Teams)** because of the overlap. (Worktree isolation prevents same-file contention.)

### Phase 3 — `/specqa` (parallel, Haiku per sub-Spec)

Each sub-Spec is checked: every completion condition has a mechanically-checkable verifyHint (grep, curl, test command). All 4 pass quality gate.

### Phase 4 — `/introspect` (parallel, Opus per sub-Spec)

Per-sub-Spec confidence + assumptions:
- sub-1-route: confidence 9, assumes Express
- sub-2-payload: confidence 9, assumes `git rev-parse --short HEAD` is available at build time
- sub-3-test: confidence 8, assumes `pnpm test --filter` selector matches
- sub-4-docs: confidence 9
- All ≥ 6 → no blocks.

### Phase 5 — parallel `/goal` per DAG leaf (Mode B teams; Sonnet exec)

Topological execution:
1. Round 1: `sub-1-route` runs alone (no deps). Teammate spawns Claude Code background session with the SPEC. Writes `src/routes/health.ts` and `src/router.ts` in its worktree. Returns FINISHED.
2. Round 2: `sub-2-payload` (depends on sub-1) runs alone. Reads sub-1's worktree output, refines `src/routes/health.ts` payload shape. Returns FINISHED.
3. Round 3: `sub-3-test` runs alone. Writes the integration test. Runs it. Returns FINISHED with `cc-test-passes` evidence.
4. Round 4: `sub-4-docs` runs alone. Updates README.

(If sub-Specs had been independent, they would have run in parallel. The dependency chain here makes them serial.)

### Phase 6 — per-sub-Spec `/verify` (parallel, blind Opus)

4 blind Opus sessions, one per sub-Spec. Each reads the repo (post-merge), runs the verifyHints, returns:

```json
{
  "perCondition": [{"id": "cc-route-registered", "met": true, "evidence": "grep matched src/router.ts:42"}],
  "verdict": "verified",
  "notes": ""
}
```

### Phase 7 — rollup `/verify` (blind Opus)

One more blind pass against `rollupCompletionConditions`. Runs `curl -s localhost:3000/health | jq` and `pnpm test`. Returns `verified`.

### Phase 8 — memory record + stop hook

`memory.runs` gets a row:
- `spec_title`: "add a /health endpoint..."
- `status`: `finished`
- `plan`: `max5x` (or your actual)
- `mode`: `teams`
- `cost_usd`: ~$3.50 (estimate; actual billed against Agent SDK credit)
- `evidence_json`: rollup verdict + per-sub-Spec evidence

Stop hook fires ntfy.sh push to your phone: `claudemax: project-name run finished at 2026-05-20T20:10:00Z (4 files changed)`.

## Cost shape for this example

| Phase | Tier | Approx credit | Why |
|---|---|---|---|
| /deepresearch | Sonnet + Opus synth | ~$0.40 | 5 sources, small synthesis |
| multispec decompose | Opus | ~$0.30 | one structured-output call |
| /specqa (×4) | Haiku | ~$0.05 | cheap quality checks |
| /introspect (×4) | Opus | ~$0.40 | confidence per sub-Spec |
| /goal sub-Specs (×4) | Sonnet | ~$1.50 | the actual work |
| /verify per sub-Spec (×4) | Opus | ~$0.60 | blind reads |
| /verify rollup | Opus | ~$0.20 | curl + test run |
| **total** | | **~$3.45** | |

On Max 20x ($200/mo): ~3.5% of monthly credit per run. ~50 runs of this size per month before cost-guard kicks in at 70%.
On Max 5x ($100/mo): ~7% per run. ~25 runs per month before guard.

## What can go wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Mode B fails to spawn teammates | `claude` CLI not on PATH or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` not set | Check `cmax bg status`; export the env var in `.claude/settings.json` (claudemax does this for you in this repo, but your project needs it too — `cmax init` propagates) |
| `/verify` returns `partial` | a verifyHint wasn't mechanically checkable | Either iterate `/goal` on the failing condition, or re-spec with a tighter verifyHint |
| Hits max-turns | sub-Spec was too big | Re-spec with smaller sub-Specs; the decomposer aims for ≤20-60 turns per sub-Spec |
| Cost-guard demotes Opus to Sonnet mid-run | monthly credit > 70% consumed | Check `cmax memory credit`; either wait for monthly reset or use `--force` past 95% |

## Files referenced

- `SPEC.example.md` — the original (single-spec) example from v0.1
- See `docs/MULTISPEC.md` for the engine reference
- See `docs/PARALLELISM.md` for Mode A vs Mode B
- See `docs/AGENT_TEAMS.md` for the Mode B deep-dive
