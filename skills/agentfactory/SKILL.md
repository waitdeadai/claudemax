---
name: agentfactory
description: Governed AgentDefinition creation. Writes a typed agent spec to `agents/<name>.json` and registers it in a Hermes-style index at `agents/registry.json` for reuse across runs.
---

# /agentfactory — governed agent creation

For when you want to create a reusable typed agent (e.g., a `code-reviewer` agent or a `migration-runner` agent) rather than re-specifying its behavior every run.

## What it creates

```
agents/
  registry.json           # index of all agents
  code-reviewer.json      # individual agent definition
  migration-runner.json
  ...
```

Each agent definition: `{ name, description, prompt, tier, tools, createdAt, version }`.

## How agents get used

- `/dispatch` and the multispec engine can reference registered agents by name in their `agents:` map.
- Versioned: editing an agent bumps its version; old versions are retained in `agents/<name>.v<N>.json` for reproducibility.

## When to create a new agent

- A specialized workflow you'll run >3 times (it's worth the abstraction).
- A taste/style requirement that benefits from a dedicated reviewer.
- A multi-step procedure with consistent shape (e.g., "run tests, summarize failures, propose fixes").

## When NOT to create a new agent

- One-off tasks — just use the umbrella.
- Things the umbrella already does well — don't fragment the surface.
- Anything that overlaps with an existing agent in the registry — extend, don't duplicate.
