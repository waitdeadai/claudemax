# Changelog

All notable changes to response-clock are documented here. Versioning follows
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-06-06

### Added

- `MessageDisplay` hook (`stamp-thinking.sh`): prepends `[HH:MM:SS]` to the first
  visible chunk of the response — the instant the model finishes thinking and starts
  emitting text. Stamps once per turn (per-session marker), takes a fast path on every
  later chunk, and is strictly fail-safe: if the chunk text can't be read it emits
  nothing, so response text is never dropped or altered. Display-only (`displayContent`).
- `PreToolUse` hook (`stamp-firsttool.sh`): on the first tool call of a turn, injects
  `additionalContext` ("thinking finished at …") — the reliable, documented complement
  for tool-only turns. Never sets a `permissionDecision`, so it can't block a tool.
- Per-turn markers reset by `stamp-start.sh` and cleared by `stamp-end.sh`.
- New env knobs: `CMAX_CLOCK_THINKING`, `CMAX_CLOCK_FIRSTTOOL`, `CMAX_CLOCK_THINK_LABEL`,
  `CMAX_CLOCK_THINK_ELAPSED`, `CMAX_CLOCK_DEBUG`.
- `_clock-lib.sh`: `rc_session_id_fast` (jq-free hot path) and `rc_extract_display_text`
  (probes plausible string fields; objects/arrays ignored).
- Smoke tests extended to 19 (thinking dedup + fail-safe + disable; first-tool dedup +
  non-blocking).

### Note

- `MessageDisplay`'s stdin schema is undocumented; `rc_extract_display_text` probes a set
  of plausible string fields. With `CMAX_CLOCK_DEBUG=1`, raw payloads are logged so the
  exact field can be confirmed and pinned.

## [0.1.0] — 2026-06-06

### Added

- `UserPromptSubmit` hook (`stamp-start.sh`): records the local turn-start time
  keyed by `session_id` and shows it to the user as the response's opening frame.
- `Stop` hook (`stamp-end.sh`): prints the local end time plus elapsed duration in
  brackets, e.g. `[17:09:20 · 1m 27s]`, then clears the per-session start file.
- Env-driven config: `CMAX_CLOCK_ENABLE`, `CMAX_CLOCK_SHOW_START`,
  `CMAX_CLOCK_SHOW_ELAPSED`, `CMAX_CLOCK_FORMAT`, `CMAX_CLOCK_TZ`,
  `CMAX_CLOCK_EMOJI`, `CMAX_CLOCK_START_PREFIX`, `CMAX_CLOCK_END_LABEL`,
  `CMAX_CLOCK_CONTEXT`.
- Zero-dependency design: pure `bash` + coreutils `date`; `jq` used if present,
  with a POSIX `grep`/`sed` fallback for `session_id` extraction.
- `test/run.sh`: simulates real hook payloads and asserts the emitted JSON.
