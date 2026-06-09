---
name: opusolo
description: Max-effectiveness umbrella. Opus for EVERYTHING — planning, decomposition, sub-Spec /goal execution, verification. Use for novel domains, security/auth/payments, or when you want the highest ceiling regardless of cost.
---

# /opusolo — all-Opus mode

Identical pipeline to /cmax, but Opus executes the sub-Spec /goal loops instead of Sonnet. Costs ~3× more in credit but ceiling effectiveness for the hardest single-sitting work.

> Since 2026-06-09 there is one tier higher for **long-horizon** work: Fable 5 (`cmax loop run --fable`, or `--tier fable` per packet) — 2× Opus price, usage-credit billed on Max after 2026-06-22. For security/auth/payments work /opusolo remains the ceiling: the router never routes those domains to Fable (its safety classifiers fall back to Opus anyway). See `docs/MODEL_ROUTING.md`.

## Pipeline

1. /deepresearch (Opus synthesis)
2. multispec decompose (Fable 5 authors while included →2026-06-22; Opus after)
3. /specqa + /introspect gates (Opus)
4. parallel /goal per DAG leaf — **Opus 4.8 executes**
5. per-sub-Spec /verify (Opus, blind)
6. rollup /verify (Opus, blind)
7. memory record

## When to invoke

- Security / auth / payments / billing / crypto work.
- Novel-domain implementations where you don't have a clear pattern.
- Hard debugging across many files where Sonnet has been spinning.
- Architectural changes that affect contracts you don't want to revisit.
- You're on Max 20x with credit headroom and want max effectiveness.

## When NOT to invoke

- Routine work — use /cmax, it'll be 3× cheaper for the same outcome.
- You're past 70% of monthly Agent SDK credit — the router will demote some sub-Specs anyway; /cmax gives you predictable cost.
- Multi-day/overnight converge loops on non-security work — `cmax loop run --fable` is the purpose-built ceiling there.

## Cost shape

Same scope as /cmax but ~3× the credit. A 6-sub-Spec refactor: ~$6–15 in Agent SDK credit. On Max 20x ($200/mo), 10–25 /opusolo runs/month before cost-guard kicks in.
