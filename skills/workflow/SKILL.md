---
name: workflow
description: Alias for /cmax. Same FAT umbrella that auto-runs deepresearch + multispec + parallel /goal + verify. Use this if you remember /workflow from minmaxing v1.
---

# /workflow — v1 muscle-memory alias for /cmax

Identical behavior to /cmax. The full multispec pipeline:

1. /deepresearch the topic (web-current, sourced)
2. multispec decompose (Opus → N sub-Specs + DAG + rollup conditions)
3. /specqa each sub-Spec
4. /introspect each sub-Spec (block if confidence < 6)
5. parallel /goal per DAG leaf (Mode A SDK subagents or Mode B Agent Teams, auto-selected)
6. per-sub-Spec /verify (blind Opus)
7. rollup /verify (blind Opus against rollup conditions)
8. memory record + state snapshot

See `/cmax` for full reference.
