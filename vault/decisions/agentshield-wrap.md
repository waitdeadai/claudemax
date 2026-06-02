---
kind: decision
slug: agentshield-wrap
title: ecc-agentshield is WRAPPED (external CLI), never a dependency — /cc-audit verdict
decision: 'Integrate ecc-agentshield (github.com/affaan-m/agentshield, MIT) only as an EXTERNAL CLI invoked via npx behind `cmax security-scan` — never as an npm dependency of any claudemax package. The default invocation is the STATIC, read-only scan (no --opus, no --fix, no network). The broader Everything-Claude-Code (ECC) project it ships with is NOT integrated.'
rationale: 'cc-audit of ECC (~200k stars, cross-harness, "dividing the community" over over-engineering) found it overlaps claudemax (skills, memory, routing, research, verify) and its cross-harness premise violates the anthropic-only invariant — so ECC as a whole is IGNORE. The one net-new, lean, Anthropic-native piece is agentshield: a config-security auditor (hardcoded secrets, over-broad permissions, hook injection, MCP risks, prompt-injection vectors) that claudemax lacks — its dark-pattern hooks check OUTPUT honesty, not CONFIG security. Empirically validated: a static scan graded this repo C (73/100) with 9 real findings (no deny-list, all mutable tool categories allowed, a log-suppressing hook). It CANNOT be a dependency because it pulls the bare @anthropic-ai/sdk, which [[anthropic-only]] forbids inside this repo — so it is wrapped out-of-process (the searchoclock vendoring pattern), keeping that dep in agentshield''s own tree.'
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-06-02
ttl_days: 180
tags: [security, agentshield, cc-audit, anthropic-only, vendoring, hard-rule]
source: cc-audit verdict on github.com/affaan-m/agentshield (v1.4.0) + live static scan of this repo
---

## Decision

`ecc-agentshield` is WRAPPED as an external CLI (`cmax security-scan` → `npx ecc-agentshield scan`), never a dependency. Default = static, read-only. ECC-the-platform is IGNORE (overlap + cross-harness violates anthropic-only + over-engineered for a lean harness).

## Why agentshield specifically (and nothing else from ECC)

- **Net-new:** config-security auditing — secrets in `CLAUDE.md`/`settings.json`, over-broad allows (`Bash(*)`), missing deny-lists, hook injection, MCP/supply-chain risks, prompt-injection vectors. claudemax's `llm-dark-patterns` hooks police output honesty, not config security.
- **Anthropic-native + lean:** scans `.claude/` setups; one focused job. Fits the harness ethos (unlike the 116–232-skill ECC platform, which `/harness-audit` would prune).
- **Validated:** `npx ecc-agentshield scan --path .claude` → Grade C (73/100), 9 findings, static + read-only, no pool.

## Why WRAP, not depend

agentshield depends on the bare `@anthropic-ai/sdk`; [[anthropic-only]] permits only `@anthropic-ai/claude-agent-sdk` inside claudemax packages. Running it out-of-process via npx keeps that dependency external. Same posture as the `searchoclock` / `llm-dark-patterns` vendored tools.

## Consequences

- `cmax security-scan [path]` shells to `npx ecc-agentshield@latest scan` (static default; `--gate`/`--baseline` for CI; `--opus`/`--fix` strictly opt-in).
- The Opus deep-analysis mode (`--opus`) is opt-in only — it spends the Anthropic pool.
- Revisit if agentshield drops the bare-SDK dependency (then a vendored install could replace npx) or if claudemax grows its own config-security scanner.
