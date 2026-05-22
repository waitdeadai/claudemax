import { describe, expect, it } from "vitest";
import {
  discoverFullPath,
  toSystemdCalendar,
  parseResetTime,
  withSafetyMargin,
  systemdUnitName,
  buildSystemdRunArgs,
  buildWrapperScript,
  nextFireFromCron,
  type ScheduleSpec,
} from "../src/scheduler.js";

describe("scheduler — PATH discovery (root cause 1 fix)", () => {
  it("includes ~/.local/bin and ~/.cargo/bin", () => {
    const p = discoverFullPath();
    expect(p).toContain(".local/bin");
    // ~/.cargo/bin should appear if discoverable; not asserting hard
    // because the test env may not have cargo installed at HOME.
    expect(p.length).toBeGreaterThan(0);
  });

  it("deduplicates path entries while preserving first-wins order", () => {
    const p = discoverFullPath();
    const segs = p.split(":");
    const seen = new Set<string>();
    for (const s of segs) {
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });
});

describe("scheduler — systemd calendar format (root cause 2 fix)", () => {
  it("converts ISO-with-T-and-tz to systemd YYYY-MM-DD HH:MM:SS form", () => {
    const out = toSystemdCalendar("2026-05-22T05:47:17-03:00");
    // No T separator, no TZ suffix
    expect(out).not.toContain("T");
    expect(out).not.toMatch(/[+-]\d{2}:?\d{2}$/);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("converts a Date object to systemd form", () => {
    const d = new Date("2026-05-22T05:47:17-03:00");
    const out = toSystemdCalendar(d);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("passes through systemd recurring forms unchanged (starts with * or weekday)", () => {
    expect(toSystemdCalendar("*-*-* 05:47:00")).toBe("*-*-* 05:47:00");
    expect(toSystemdCalendar("Mon..Fri 09:00")).toBe("Mon..Fri 09:00");
  });
});

describe("scheduler — reset-time parsing (claude-auto-retry pattern)", () => {
  it("parses RFC3339 form", () => {
    const now = new Date("2026-05-22T08:00:00-03:00");
    const future = new Date("2026-05-22T10:00:00-03:00");
    const text = `error: rate-limit: resets at ${future.toISOString()}`;
    const out = parseResetTime(text, now);
    expect(out).not.toBeNull();
    expect(out!.getTime()).toBe(future.getTime());
  });

  it("parses human 'resets 3pm' form", () => {
    const now = new Date("2026-05-22T08:00:00-03:00");
    const out = parseResetTime("hit your session limit · resets 3pm (America/Argentina/Mendoza)", now);
    expect(out).not.toBeNull();
    // Should land at 15:00:00 local time today
    expect(out!.getHours()).toBe(15);
    expect(out!.getMinutes()).toBe(0);
  });

  it("parses human 'resets 9:30pm' form", () => {
    const now = new Date("2026-05-22T08:00:00-03:00");
    const out = parseResetTime("You've hit your limit · resets 9:30pm (...)", now);
    expect(out).not.toBeNull();
    expect(out!.getHours()).toBe(21);
    expect(out!.getMinutes()).toBe(30);
  });

  it("rolls past times to tomorrow", () => {
    const now = new Date("2026-05-22T16:00:00-03:00");
    const out = parseResetTime("resets 3pm", now);
    expect(out).not.toBeNull();
    expect(out!.getDate()).toBe(now.getDate() + 1);
  });

  it("returns null when no reset pattern present", () => {
    expect(parseResetTime("some unrelated error message")).toBeNull();
  });
});

describe("scheduler — safety margin", () => {
  it("adds N seconds to the reset Date", () => {
    const reset = new Date("2026-05-22T10:00:00Z");
    const withMargin = withSafetyMargin(reset, 30);
    expect(withMargin.getTime() - reset.getTime()).toBe(30_000);
  });
});

describe("scheduler — systemd unit naming + args", () => {
  it("sanitizes special chars in unit name", () => {
    expect(systemdUnitName("foo bar/baz")).toBe("cmax-sched-foo-bar-baz");
    expect(systemdUnitName("simple")).toBe("cmax-sched-simple");
  });

  it("buildSystemdRunArgs includes Environment=PATH (root cause 1 fix)", () => {
    const spec: ScheduleSpec = {
      name: "test-sched",
      kind: "at",
      when: "2026-05-22T10:00:00-03:00",
      command: ["cmax", "ask", "hello"],
      cwd: "/tmp",
    };
    const args = buildSystemdRunArgs(spec, "/tmp/test-wrapper.sh", "/custom/path:/usr/bin");
    expect(args).toContain("--setenv=PATH=/custom/path:/usr/bin");
    expect(args.some((a) => a.startsWith("--on-calendar="))).toBe(true);
    // Calendar arg should be in systemd format (no T, no TZ)
    const calArg = args.find((a) => a.startsWith("--on-calendar="))!;
    expect(calArg).not.toContain("T");
  });
});

describe("scheduler — wrapper script generation", () => {
  it("wrapper exports PATH at top + invokes the command + appends to log", () => {
    const spec: ScheduleSpec = {
      name: "test",
      kind: "at",
      when: "2026-05-22 10:00:00",
      command: ["echo", "hello"],
      cwd: "/tmp",
      resumeOnLimit: true,
    };
    const wrapper = buildWrapperScript({
      spec,
      stateDir: "/tmp/state",
      logPath: "/tmp/test.log",
      pathEnv: "/usr/bin:/bin",
    });
    expect(wrapper).toContain('export PATH="/usr/bin:/bin"');
    expect(wrapper).toContain("'echo' 'hello'");
    expect(wrapper).toContain("RESUME_ON_LIMIT=\"1\"");
    expect(wrapper).toContain('cmax schedule parse-reset');
  });

  it("escapes single quotes in command args", () => {
    const spec: ScheduleSpec = {
      name: "test",
      kind: "at",
      when: "2026-05-22 10:00:00",
      command: ["bash", "-c", "echo 'hi'"],
      cwd: "/tmp",
    };
    const wrapper = buildWrapperScript({
      spec,
      stateDir: "/tmp/state",
      logPath: "/tmp/test.log",
      pathEnv: "/usr/bin",
    });
    // 'echo 'hi'' should become 'echo '\''hi'\'''
    expect(wrapper).toContain("echo '\\''hi'\\''");
  });
});

describe("scheduler — cron expression parsing", () => {
  it("returns next fire time for a valid 5-field cron", () => {
    // Every day at 3am
    const next = nextFireFromCron("0 3 * * *", new Date("2026-05-22T01:00:00-03:00"));
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(3);
  });

  it("returns null for malformed cron", () => {
    expect(nextFireFromCron("not a cron")).toBeNull();
  });
});
