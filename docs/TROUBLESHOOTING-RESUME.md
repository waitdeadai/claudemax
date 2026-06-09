# Troubleshooting: `/resume` picker shows no sessions (in every claudemax folder)

Operator note, 2026-06-09. Symptom: the interactive `/resume` (and `claude --resume`
with no id) conversation picker shows "no conversations" in every folder where the
claudemax harness is active, even though sessions exist.

## Root cause — upstream Claude Code regression, not a harness bug

The `/resume` **picker discovery** was broken by an upstream Claude Code change:
the picker began default-filtering by current directory at ~2.1.123 and the
discovery was fixed in **2.1.161**. Versions **2.1.123–2.1.160 sit in the broken
window.** This machine was on **2.1.154**.

Evidence it is the picker, not the store or the harness:

- `claude --resume <uuid> --print` **works** (the resume *load* path is fine) —
  only the interactive picker's *discovery* fails.
- The session store is healthy: 127 transcripts, 0 zero-byte, 0 unparseable, 0
  locks, all tagged `version=2.1.154`.
- All claudemax `SessionStart` hooks exit 0 with bounded valid JSON under a
  `resume` payload — they fire *after* you pick a session, so they cannot break
  discovery.
- Matches upstream reports: anthropics/claude-code
  [#54542](https://github.com/anthropics/claude-code/issues/54542),
  [#22878](https://github.com/anthropics/claude-code/issues/22878)
  ("`--resume` picker shows none, direct-uuid resume works"); fixed per the
  2.1.161 changelog.

"Every folder where I have claudemax" is explained by: every folder runs the same
buggy CLI version.

## Fix applied (2026-06-09)

Upgraded the native CLI to the **minimal fixing version** (smallest delta):

```bash
claude install 2.1.161        # native installer; not npm. 2.1.154 retained on disk
claude --version              # → 2.1.161
```

Verified headless (no regression): basic `--print` loop, `--resume <uuid> --print`
load path, `SessionStart` hook JSON validity, and `cmax doctor` all pass on 2.1.161.
The interactive picker itself can only be confirmed in the TUI — open `claude` in
any folder and run `/resume`; sessions should now list.

Rollback if anything misbehaves:

```bash
claude install 2.1.154
```

Workaround while on any broken version (no upgrade needed): `claude --resume <id>`
or `claude --continue` both work; only the no-argument picker is affected.

## Related, non-blocking: SessionStart hook duplication (recommended, NOT auto-applied)

Separate bug found during the investigation (it causes the **tripled** SessionStart
context, not the resume failure). Inside this repo, three cross-project hooks fire
**twice** — once from the global `~/.claude/settings.json` and once from the repo
`.claude/settings.json`:

- `cmax-session-start.sh`, `time-anchor.sh` (`dp.sh`), `state-sessionstart.sh` (`dp.sh`)

The global config already runs all three for every folder; the repo copy duplicates
them. `freshness-gate.sh` is repo-unique and must stay.

This was **deliberately not auto-committed**: the correct ownership depends on
whether every machine's global config reliably carries these three (this repo's
`setup.sh` does not write that global block, and `cmax init` puts
`cmax-session-start.sh` in *project* settings), so removing them from the committed
file could drop SessionStart grounding for a contributor whose global lacks them.
Bless and apply the dedup when you've confirmed your global config is the canonical
source. Recommended edit to repo `.claude/settings.json` → `hooks.SessionStart[0].hooks`:

```diff
   {
     "matcher": ".*",
     "hooks": [
-      { "type": "command", "command": ".claude/hooks/cmax-session-start.sh" },
-      { "type": "command", "command": ".claude/hooks/freshness-gate.sh", "timeout": 5 },
-      { "type": "command", "command": "bash .claude/hooks/dp.sh time-anchor.sh", "timeout": 3 },
-      { "type": "command", "command": "bash .claude/hooks/dp.sh state-sessionstart.sh", "timeout": 5 }
+      { "type": "command", "command": ".claude/hooks/freshness-gate.sh", "timeout": 5 }
     ]
   }
```

Verify after applying (asserts bounded, single-fire, valid JSON):

```bash
P='{"hook_event_name":"SessionStart","source":"resume","cwd":"'"$PWD"'","session_id":"x"}'
echo "$P" | bash .claude/hooks/dp.sh state-sessionstart.sh | python3 -m json.tool >/dev/null && echo OK
```
