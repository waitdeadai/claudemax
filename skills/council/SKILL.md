---
name: council
description: 3-Opus adversarial debate (proposer / critic / judge) for architectural decisions. Use when a decision is irreversible and benefits from explicit adversarial framing.
---

# /council — adversarial debate with roles

Three Opus instances with explicit roles run in parallel and then in sequence:

- **Proposer** — makes the strongest case FOR a specific position.
- **Critic** — makes the strongest case AGAINST any obvious position. Finds holes, edge cases, costs, alternative framings.
- **Judge** — weighs both, renders a final decision with rationale + flip conditions.

Proposer and critic run in parallel; judge runs after fan-in.

## When to use

- Architectural decisions you can't easily reverse (database choice, framework migration, contract redesign).
- High-stakes questions where the obvious answer might be wrong.
- When you've drafted a plan and want a sanity-check before committing.

## When NOT to use

- Routine choices — overkill.
- Time-sensitive decisions — council takes ~3× a single Opus pass.
- Questions of pure fact — that's /deepresearch.

## Cost

3 Opus invocations in parallel + 1 sequential judge = ~4× a single Opus call. Cheap relative to a wrong architectural decision.

## Distinct from

- **/hive** — N drafters merged into one answer; no adversarial framing.
- **/audit** — finds holes in existing code; council finds holes in proposed plans.
