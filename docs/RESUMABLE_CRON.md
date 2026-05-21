# Resumable cron — session-limit-aware mega-build

> Status: shipped 2026-05-21 (claudemax HEAD `f273fa3`+).
> Skills: `/mega`, `/resume`. CLI: `cmax mega`, `cmax resume`.
> Empirical motivation: an 11-lane `cmax orchestrate` against Max 20x shared 5h pool failed `ALL-FAILED` at 624s wall clock (see `tasks/b8pmf8y0i.output` + `tenants/test/VERDICT.md`). The pool saturated and every lane died simultaneously.

## Design summary

```
cmax mega "<goal A>" "<goal B>" ...
   │
   ├── probeHardware()              os.availableParallelism + freemem + loadavg
   ├── detectPlan()                 Plan tier + era (pre/post 2026-06-15)
   ├── deriveLanes()                min(cores, ram, plan-cap); /2 if thermal
   │
   ├── initialState() → state.json  per-lane status (pending/running/finished/paused/failed)
   │
   └── driveLanes()
        ├── spawn N `cmax run` subprocesses
        ├── monitor stdout for rate-limit signals
        ├── on saturation: status="paused" + checkpoint + exit 2
        └── on complete: status="finished" + exit 0

cmax resume [run-id]
   ├── findLatestResumableRun()     if no run-id
   ├── pendingLanes(state)          filter pending/paused
   └── driveLanes()                 same loop, idempotent

systemd timer (cmax-resume.timer)
   ├── OnUnitActiveSec=30min
   ├── RandomizedDelaySec=5min     jitter (avoids thundering herd)
   └── runs `cmax resume` → no-op exit 0 if nothing pending
```

## File layout

```
.claudemax/state/resumable/<run-id>/
├── state.json          (ResumableState)
├── summary.md          (human-readable, includes resume command)
└── <lane-id>.memory.sqlite   per-lane memory db
```

## `ResumableState` shape

```typescript
interface ResumableState {
  version: 1;
  runId: string;                 // "run-<unix-ms>"
  createdAt: string; updatedAt: string; cwd: string;
  orchestrateFlags: { variant, confidence, mode, maxParallel, tdd };
  lanes: Record<string, {
    id: string; goal: string; cwd: string;
    status: "pending" | "running" | "finished" | "partial" | "failed" | "paused";
    startedAt?, finishedAt?, exitCode?: number;
    attempts: number;
    lastPauseReason?, lastPauseAt?: string;
  }>;
}
```

## Hardware-aware lane sizing

In `packages/runtime/src/hardware.ts`:

```typescript
lanes = max(1, min(
  availableParallelism(),       // Node 19.4+; respects cgroup/container limits
  floor(freeMemGB / 1.5),       // RAM_PER_LANE_GB ≈ 1.5 (cmax-run heap + Claude Code WS buffer)
  PLAN_LANE_CAP[plan]           // max5x=6, max20x=10, pro=3, api=16
));
if (loadavg1m > 0.8 * availableParallelism) lanes = max(1, floor(lanes / 2));
```

Source: `os.availableParallelism()` reads `sched_getaffinity` + cgroup v2 `cpu.max` ([Node PR #45895](https://github.com/nodejs/node/pull/45895), accessed 2026-05-21). `loadavg` proxy used because `availableParallelism` doesn't detect thermal throttle ([libuv #4146](https://github.com/libuv/libuv/issues/4146), accessed 2026-05-21).

## Saturation detection

`packages/runtime/src/saturation.ts` evaluates Anthropic SDK `rate_limit_event` messages. Confirmed envelope (probe 2026-05-21):

```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "status": "allowed" | "warning" | "exceeded",
    "resetsAt": <unix>,
    "rateLimitType": "five_hour" | "seven_day_opus" | "seven_day_sonnet" | "seven_day",
    "utilization": 0..1   // OMITTED below warning threshold
  },
  "uuid": "...",
  "session_id": "..."
}
```

Pause trigger: `status === "exceeded"` OR (`utilization >= 0.85` AND bucket in `{five_hour, seven_day_opus, seven_day}`).

Bucket enum kept as open string union — when Anthropic announces the post-2026-06-15 `monthly_agent_sdk` bucket the code requires zero change.

Source: [anthropics/claude-code#50518](https://github.com/anthropics/claude-code/issues/50518) (per-bucket utilization feature, accessed 2026-05-21). `SDKRateLimitInfo`/`SDKRateLimitEvent` types added in Claude Code v2.1.45 (2026-02-17, [release notes](https://claude-world.com/articles/claude-code-2145-release/)).

## systemd timer template

`infra/cmax-resume.timer`:

```ini
[Unit]
Description=cmax resume scheduler

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
RandomizedDelaySec=300
AccuracySec=1min
Persistent=true
Unit=cmax-resume.service

[Install]
WantedBy=timers.target
```

`infra/cmax-resume.service`:

```ini
[Unit]
Description=cmax resume — pick up the latest paused mega run
After=network-online.target

[Service]
Type=oneshot
ExecStart=/home/fer/.local/bin/cmax resume
WorkingDirectory=/home/fer/waitdead-v2
Environment=CMAX_PLAN=max20x
StandardOutput=append:/var/log/cmax-resume.log
StandardError=append:/var/log/cmax-resume.log
```

Install:
```bash
sudo cp infra/cmax-resume.{service,timer} /etc/systemd/system/
sudo systemctl enable --now cmax-resume.timer
```

Cross-platform note: macOS users substitute `launchd` plist; standalone `cron` works on all unix-likes with `* */1 * * * cmax resume` (less elegant but functional).

## Effectiveness-first framing

Per Anthropic's 2026 Agentic Coding Trends Report ([resources.anthropic.com](https://resources.anthropic.com/2026-agentic-coding-trends-report), accessed 2026-05-21): the gain from AI tooling is "a much larger net increase in output volume — more features shipped, more bugs fixed, more experiments run — rather than simply doing the same work faster." `/mega` is the harness's vehicle for that — one command, N goals, the envelope managed for you, completion guaranteed across rate-limit windows.

## References (all accessed 2026-05-21)

- [Anthropic 2026 Agentic Coding Trends Report](https://resources.anthropic.com/2026-agentic-coding-trends-report)
- [anthropics/claude-code#50518 — per-bucket rate-limit utilization](https://github.com/anthropics/claude-code/issues/50518)
- [anthropics/claude-code#26392 — SDK rate_limit docs gap](https://github.com/anthropics/claude-code/issues/26392)
- [anthropics/claude-code#16713 — `/usage` Max-plan availability](https://github.com/anthropics/claude-code/issues/16713)
- [Anthropic Usage & Cost API (Admin only)](https://platform.claude.com/docs/en/api/usage-cost-api)
- [Anthropic Rate Limits API (Admin only)](https://platform.claude.com/docs/en/manage-claude/rate-limits-api)
- [Claude Code v2.1.45 release notes](https://claude-world.com/articles/claude-code-2145-release/)
- [Apiyi billing-split brief (June 15 2026)](https://help.apiyi.com/en/anthropic-claude-subscription-agent-sdk-billing-split-june-2026-en.html)
- [Node `availableParallelism` PR](https://github.com/nodejs/node/pull/45895)
- [libuv #4146 — `availableParallelism` does not detect thermal throttle](https://github.com/libuv/libuv/issues/4146)
- [systemd Arch wiki](https://wiki.archlinux.org/title/Systemd/Timers)
- [ralph-claude-code — reference resume pattern](https://github.com/frankbria/ralph-claude-code)
- [cli-continues — cross-tool session index](https://github.com/yigitkonur/cli-continues)
- [GitHub Copilot CLI GA (PR-only push guardrails)](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/)
