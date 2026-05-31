---
kind: decision
slug: anthropic-only
title: Anthropic-only by design — all provider calls route through the Agent SDK query()
decision: 'All provider calls route through `query()` from `@anthropic-ai/claude-agent-sdk`. The bare `@anthropic-ai/sdk` (which would require `ANTHROPIC_API_KEY`) is NOT a dependency and must not be reintroduced. No new providers — Anthropic-only. If a task wants MiniMax, OpenAI, or any other provider, push back.'
rationale: 'claudemax is an Anthropic-native, subscription-first harness for Claude Max users. Routing everything through the Agent SDK `query()` keeps auth on the Max subscription pool instead of an API key, preserves the deterministic harness posture, and prevents provider sprawl that would dilute the harness''s identity. Structured output uses `outputFormat: { type: "json_schema", schema }` via `query()`, not a second SDK.'
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-05-31
ttl_days: 365
tags: [anthropic, hard-rule, auth, providers]
source: CLAUDE.md
---

## Decision

All provider calls route through `query()` from `@anthropic-ai/claude-agent-sdk`.
The bare `@anthropic-ai/sdk` is not a dependency; don't reintroduce it. No new
providers are permitted — the harness is Anthropic-only by design.

## Rationale

The ICP is Claude Max users (5x and 20x, first-class equals). Subscription-first
auth means every call rides the Max pool via the Agent SDK, never an API key.
Adding a second provider SDK would reintroduce `ANTHROPIC_API_KEY` coupling and
break the subscription-first guarantee, and adding non-Anthropic providers would
break the harness's core identity.

## Alternatives rejected

- Bare `@anthropic-ai/sdk` for structured output — rejected; requires an API key.
  Use `outputFormat: { type: "json_schema", schema }` through `query()` instead.
- Multi-provider routing (MiniMax / OpenAI) — rejected; out of scope by design.

## Consequences

- Any PR that adds `@anthropic-ai/sdk` or a non-Anthropic provider must be blocked.
- Structured output always goes through the SDK's `outputFormat` option.
- Working rule 1 in `CLAUDE.md` and the subscription-first auth section enforce this.
