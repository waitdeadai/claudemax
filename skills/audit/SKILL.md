---
name: audit
description: Adversarial code-quality scan of existing code — look for holes, smells, edge cases, missing tests. Read-only. Distinct from /review (which scans proposed diffs) and /investigate (which root-causes a specific bug).
---

# /audit — adversarial scan of existing code

Read-only, adversarial. The auditor's job is to find what's wrong, not to praise what's right.

## Scope

- Specific files, modules, or the whole repo (default: whole repo).
- Code-quality, security holes, error handling gaps, missing tests, dead code, contract violations.

## Process

1. Inventory the surface (files, exports, public functions, side-effect surfaces).
2. For each surface area, ask: what's the failure mode? what's untested? what's relying on undocumented invariants?
3. Cross-reference with the project's `taste.md` if present — flag deviations.
4. Output: prioritized list of holes with file:line citations and severity (critical | high | medium | low).

## When to use

- Before a release.
- After taking over an unfamiliar repo.
- When something feels off but no specific bug is visible.

## Distinct from

- `/review` — reviews a proposed diff (what's about to change). Audit reviews the existing repo as-is.
- `/investigate` — depth-first on one specific symptom or bug. Audit is breadth-first across many surfaces.
- `/verify` — checks SPEC completion. Audit doesn't need a SPEC.
