---
name: goal
description: Autonomous Opus loop that pursues a SPEC across multiple turns until every completion condition is satisfied or a real blocker surfaces. Use only when the work is non-decomposable and benefits from sustained reasoning. Always preceded by /spec.
---

# /goal — autonomous goal loop

Hand the SPEC to an Opus driver that works across many turns until every completion condition is met. Inspired by Claude Code 2.1.139's `/goal` semantics; sharpened by claudemax's spec-first gate and supervisor verification.

## Pre-requisites

1. `SPEC.md` exists at the project root.
2. Every completion condition has a verifyHint a blind reviewer could check.
3. The user understands this may run for many turns and incur significant Opus cost.

## Loop behavior

- After every meaningful change, the driver re-evaluates the completion conditions.
- When all are met, it emits a `FINISHED` block with per-condition evidence and exits.
- When it cannot proceed (missing credential, ambiguous requirement, irreversible decision), it emits `BLOCKED` with what would unblock.
- It does not invent success. If verifyHints don't pass a blind check, the driver iterates.

## Out of scope for /goal

- Anything not in the SPEC. Even if the driver notices a broken adjacent thing, it logs it and stays in scope.
- Cost downgrades. `/goal` is always Opus. If you need cheap, decompose into `/dispatch`-able packets first.

## Output

A status (`finished | blocked | max-turns`), an evidence map keyed by completion condition id, a summary paragraph, and a session id for resumption.

## Always followed by /verify

Never declare success on the strength of `/goal`'s own claim. `/verify` runs an independent Opus pass.
