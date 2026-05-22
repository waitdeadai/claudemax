---
name: cc-audit
description: SOTA-2026 deepresearch-backed audit of new Claude Code CLI releases. Triggered on every CC update (or when a third-party signal — tweet, blog, changelog mirror — claims a new feature). Fetches the official changelog + Anthropic docs + GitHub release notes, verifies claims against primary sources, decides for each change IGNORE / WRAP / INTEGRATE / DEFER. Records the verdict so the harness never ships a conflicting or redundant tool.
allowed-tools: WebFetch, WebSearch, Read, Grep, Bash, Edit, Write
---

# /cc-audit — audit new Claude Code releases before integrating

The harness's defense against tweet-bot hallucinations, vendor over-promises, and feature-overlap. Every new Claude Code version is suspected of conflicting with claudemax's existing skills/runtime until proven otherwise.

## Trigger

- Manual: `/cc-audit <version>` (e.g. `/cc-audit 2.1.147`) when a third-party signal claims a new feature
- Automatic (recommended): on every `claude --version` bump detected by `cmax doctor`, queue a `/cc-audit <new-version>` task in the daily list

## Pipeline

1. **Anchor the temporal context.** Resolve "today" against the local time-anchor (`local_date` from the SessionStart hook). Every web fetch records its `accessedAt` date.
2. **Pull primary sources, in parallel.**
   - `WebFetch https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` (the canonical changelog)
   - `WebFetch https://code.claude.com/docs/en/release-notes/claude-code` (Anthropic docs redirect)
   - `WebFetch https://github.com/anthropics/claude-code/releases/tag/v<version>` (GitHub release notes)
3. **Cross-check third-party claim** (the tweet / blog / mirror that triggered the audit) against the primary sources. If primary sources do NOT corroborate, treat the third-party signal as `unverified`.
4. **For each new entry** in the changelog version range:
   - **Detect overlap** with existing claudemax skills/runtime/hooks via `grep -rn <feature-key> /home/fer/Documents/minmaxingv2 --include="*.ts" --include="*.md" --include="*.json" --include="*.sh"`.
   - **Decide one of:**
     - **IGNORE** — irrelevant to claudemax's surface (e.g. an MCP integration the harness doesn't expose).
     - **WRAP** — expose the new primitive behind an existing claudemax skill (e.g. `cmax doctor` gains a `--hooks` flag when CC exposes a hook-introspection API).
     - **INTEGRATE** — replace claudemax's own path with the new primitive (e.g. if CC ships a native bounded-concurrent subagent dispatcher, claudemax's `agent-teams.ts` should delegate to it).
     - **DEFER** — track in `CHANGELOG.md` `[Unreleased]` under `## Deferred` with reason + revisit date.
5. **Record the audit** in `docs/CC_AUDIT_LOG.md` as a dated row: version, source URLs, per-entry verdict, who/when/why.

## Anti-patterns the audit catches

- **Tweet-bot hallucinations.** Example: @ClaudeCodeLog (2026-05-21) claimed 2.1.147 added a "Workflow tool for deterministic multi-agent orchestration (CLAUDE_CODE_WORKFLOWS=1)". Primary changelog had no such entry; the audit ruled `unverified` and the harness skipped a fictitious integration.
- **Feature creep without subtraction.** When CC ships a native version of something claudemax already does (e.g. native goal-mode, native rate-limit-reset surfacing), the audit forces a `keep-ours / delete-ours / wrap-theirs` decision rather than maintaining both paths indefinitely.
- **Silent overlap.** A new CC flag (`--dangerously-skip-permissions`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) might already be relied on by claudemax. The audit makes that explicit.

## Output shape (paste into CHANGELOG / docs/CC_AUDIT_LOG.md)

```
## CC v<version> audit — <date>

Primary sources verified:
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (accessed <date>)
- https://github.com/anthropics/claude-code/releases/tag/v<version> (accessed <date>)

Per-entry verdict:
| Change | Source | Verdict | Action |
|---|---|---|---|
| <feature> | changelog L<n> | INTEGRATE | edit packages/runtime/...; PR #N |
| <feature> | changelog L<n> | WRAP | new skill /skills/<name>; PR #N |
| <feature> | changelog L<n> | IGNORE | irrelevant — no harness surface |
| <feature> | changelog L<n> | DEFER | revisit after <condition> |

Third-party claims investigated:
| Claim | Source | Corroborated? | Verdict |
|---|---|---|---|
| <claim> | <url> | NO | unverified — do not act |
```

## When NOT to invoke /cc-audit

- Patch-level CC releases (e.g. 2.1.148 fixing a bash exit-127 regression from 2.1.147): cmax doctor's version check is enough; no audit needed.
- Pre-release or beta builds: not stable enough to integrate; the audit produces noise.

## Coordination with other skills

- `/harness-audit` is the periodic broader review of claudemax itself (skill catalog, hook coverage, rule wording). `/cc-audit` is the narrower upstream-change review.
- When `/cc-audit` decides INTEGRATE, follow up with `/cmax` to run the actual deepresearch → multispec → /goal → verify pipeline on the integration work.
- When `/cc-audit` decides WRAP, follow up with `/agentfactory` to scaffold the wrapper skill.
