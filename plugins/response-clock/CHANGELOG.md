# Changelog

All notable changes to response-clock are documented here. Versioning follows
[Semantic Versioning](https://semver.org/).

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
