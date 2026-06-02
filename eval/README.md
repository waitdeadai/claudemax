# cmax eval — measuring effectiveness (§6)

The number that matters is the **production-hotfix-rate**: of the tasks the harness
marks `verified` ("done"), the fraction a hidden post-"done" check then finds
broken. If the anti-gaming machinery (decomposed verify / SSC / adversarial / PRC)
works, this number drops. Without it you cannot tell whether any of the rest helps.

## Usage

1. Copy `tasks.example.json` → `tasks.json` and edit each case:
   - `cwd` — absolute path to a repo/sandbox the pipeline can run in.
   - `hiddenChecks` — shell commands that EXIT NON-ZERO when the result is actually
     broken. They are NOT shown to the pipeline; they run *after* it claims done,
     so a failure is a real "said done, wasn't" event.
   - `humanVerdict` (optional) — `pass`/`fail` spot-check label → drives the
     verifier false-positive rate.
2. Run:
   - `cmax eval` — one full pass; exits non-zero if the hotfix-rate > 0.
   - `cmax eval --ablations` — compares **full** vs **no-verify** / **no-ssc** /
     **no-adversarial** so you can see the delta each piece buys.

Keep the set private: 15–30 of *your* real tasks (include a frontend one) plus a
subset of SWE-bench Verified as a baseline. `tasks.json` is gitignored; only
`tasks.example.json` is committed.
