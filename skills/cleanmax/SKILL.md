---
name: cleanmax
description: The lean variant of /cmax — same SOTA-2026 pipeline, but with minimality as a hard gate. Bakes in "simplest change that satisfies the spec", prefer-edit-over-create, a mandatory /simplify pass, and a deterministic bloat-budget gate (net-LOC + new-file budget + reinvented-symbol detection) before /ship. For evolving your own workflow code without bloating the codebase.
---

# /cleanmax — SOTA results without codebase bloat

Same engine as [/cmax](../cmax/SKILL.md) (deepresearch → multispec → parallel
/goal → verify → ship). cleanmax adds **one principle, enforced**: the change must
be the *smallest* one that satisfies the spec. It composes existing skills; it adds
no new harness — bloating the codebase to fight bloat would be self-defeating.

## What cleanmax changes vs /cmax

1. **Spec framing (in /spec + /introspect).** Every sub-Spec completion condition is
   phrased as "the *minimal* change that makes verifyHint pass." Introspect adds one
   gate: *is there an existing function/module/path that already does this?* If yes,
   the spec says "extend/reuse it," not "add new."
2. **Prefer edit over create.** /goal is instructed to edit existing files and reuse
   existing symbols by default; creating a new file/helper requires a one-line
   justification in the sub-Spec output ("no existing X to extend because …").
3. **Mandatory /simplify pass.** After each sub-Spec's /goal and before /verify, run
   the global `/simplify` skill on the diff (reuse, dedup, altitude, efficiency).
   This is quality-only and applies fixes.
4. **Deterministic bloat-budget gate (the teeth).** Before /ship, run:
   ```bash
   python3 scripts/cleanmax/bloat_budget.py --base <merge-base> \
     --max-net-loc 400 --max-new-files 3
   ```
   It flags, with no LLM: net LOC over budget, too many new files, and **reinvented
   symbols** (a new `def`/`function`/`class`/`const` whose name already exists
   elsewhere — the strongest "you re-added what exists" signal). Exit 2 blocks the
   ship. Tune budgets per task with the flags (a genuinely large feature raises them
   *explicitly*, so bloat is a decision, not an accident).
5. **/ship unchanged** otherwise — /verify (correctness) + /review (diff) still run.

## When to use

- Iterating on your own long-lived harness/workflow code (claudemax, hooks, tools)
  where every avoidable line is future maintenance.
- NOT for greenfield throwaways where speed > leanness — use /cmax there.

## Honest limits

The gate is structural: it catches net-LOC/new-file/duplicate-symbol bloat, not
semantic over-engineering (a needlessly clever abstraction that is small). That
residual is what the /simplify pass and /review judgment cover. Reinvented-symbol
detection is name-based (a renamed re-implementation slips it) — high-precision, not
exhaustive. Budgets are advisory defaults; raising them is a logged choice.
