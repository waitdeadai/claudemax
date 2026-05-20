## What

<!-- One paragraph: what does this PR change? Be specific. -->

## Why

<!-- Link to the issue or the discussion that motivated this. -->

## How tested

```bash
pnpm build
pnpm test
bash scripts/smoke.sh
# any additional manual / live-API tests:
```

## House rules check

- [ ] Anthropic-only — no new provider dependencies
- [ ] Lean catalog — if I added a skill, I checked overlap in `docs/SKILL_CATALOG.md`
- [ ] Router defaults unchanged (or discussed in description)
- [ ] `/verify`, `/spec`, `/architect` still in `NEVER_DEMOTE`
- [ ] Multispec is still the default behavior of every umbrella
- [ ] `/taste` remains auto-bootstrap (no 10-question wizard added)
- [ ] No `as any` introduced (used `as never` if SDK types are stale)
- [ ] `pnpm test` green
- [ ] `bash scripts/smoke.sh` green
- [ ] CHANGELOG.md updated under `## [Unreleased]`
- [ ] Relevant docs updated (`docs/SKILL_CATALOG.md` if added a skill, `README.md` if added a CLI command, etc.)

## Side effects

<!-- Anything reviewers should double-check: dependency updates, schema changes, config file format changes, etc. -->

## Out of scope

<!-- Anything you considered but explicitly didn't do, and why. -->
