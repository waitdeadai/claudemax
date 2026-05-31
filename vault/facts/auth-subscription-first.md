---
kind: fact
key: auth.provider.sdk
value: 'Subscription-first auth — all provider calls go through `query()` from `@anthropic-ai/claude-agent-sdk` (rides the Claude Max pool, no ANTHROPIC_API_KEY). Structured output uses `outputFormat: { type: "json_schema", schema }` via `query()`. The bare `@anthropic-ai/sdk` is NOT a dependency.'
status: accepted
blessed: true
invariant: true
scope: '**'
verified_on: 2026-05-31
ttl_days: 365
confidence: 5
tags: [auth, anthropic, sdk, structured-output]
source: CLAUDE.md
---

Subscription-first authentication is a hard claudemax invariant. Every call to the
model goes through the Agent SDK `query()` so it bills against the user's Claude
Max subscription pool rather than an API key. Structured output is requested via
the SDK's `outputFormat: { type: "json_schema", schema }` option — there is no
second SDK and no `ANTHROPIC_API_KEY` path.

When `query()` options are not yet in the SDK types (`outputFormat`, `effort`,
`fallbackModel`, `skills`, `settingSources`, etc.), cast the options object
`as never`; they are supported at runtime even when the types are stale.
