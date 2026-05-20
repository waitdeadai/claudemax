---
name: Bug report
about: A specific reproducible bug in claudemax
title: 'bug: '
labels: bug
---

## What happened

<!-- Concrete description. What command did you run? What output did you see? -->

## What you expected

<!-- The contract you thought you were getting. -->

## Reproduction

```bash
# exact commands, in order, from a fresh shell
```

## Environment

- `cmax --version`:
- `cmax doctor` output (paste here, redact sensitive fields):
- `cmax bg status` output:
- Node version (`node -v`):
- OS / distro:
- Claude Code version (`claude --version`):

## Logs / state

Paste relevant snippets from:
- `.claudemax/state/`
- `.claudemax/memory.sqlite` (`cmax memory runs --limit 5`)
- `~/.claudemax-state/config.json` (redact NTFY_TOPIC if private)

## Hypothesis (optional)

What you think might be wrong. Helps reviewers triage.
