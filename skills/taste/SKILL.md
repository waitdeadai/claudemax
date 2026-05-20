---
name: taste
description: Auto-bootstrap project taste.md + taste.vision via /deepresearch. NO 10-question wizard. Reads repo signals + researches SOTA at current time → synthesizes taste docs with zero questions (one fallback question only if repo has no signal).
---

# /taste — auto-bootstrap project kernel

Replaces v1's `/tastebootstrap` (10 kernel questions). v2 auto-derives taste from repo evidence + current-time SOTA research.

## Process

1. Read repo signals: README, package manifest, top-level structure, framework detection.
2. /deepresearch the project's SOTA at *current time*:
   - "<detected framework> best practices <YYYY-MM>"
   - "<detected domain> SOTA architecture <YYYY-MM>"
   - WebFetch official docs of detected framework.
3. Synthesize (Opus) → `taste.md` (operating principles, code style, architecture invariants, deps posture) + `taste.vision` (north star, ICP, success criteria) with **zero questions**.
4. ONE clarifying question only if the repo has no signal (empty dir, no README, no package manifest). Exact question: "What are you building, in one sentence?"
5. Show the generated docs; user accepts or edits and re-runs.

## Why auto-bootstrap

- 10 questions is friction. The model already has more signal from the repo + web than the user would type.
- Anchored on current-time SOTA, not training-cutoff opinions.
- Re-runnable cheaply — drift detection via /deepretaste is the same engine.

## CLI

```
cmax taste init                          # auto-bootstrap; writes taste.md + taste.vision
cmax taste init --regenerate              # ignore existing; re-derive from scratch
```

## What goes in taste.md vs taste.vision

- **taste.md** — declarative rules. "We use X, not Y, because Z." Code style, architecture, deps.
- **taste.vision** — narrative north star. One paragraph each: what we're building, who for, what "great" looks like.

## How the harness uses taste

- SessionStart hook reads `taste.md` and injects it into every workflow's system prompt.
- /introspect cross-references plans against taste.md and flags deviations.
- /audit and /review flag taste violations in existing code and proposed diffs.
