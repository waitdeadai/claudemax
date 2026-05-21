import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Anthropic SDK v0.3.146 emits rate_limit_event messages with this minimum
// envelope shape (confirmed via probe 2026-05-21):
//   { type: "rate_limit_event", rate_limit_info: { status, resetsAt, rateLimitType, utilization? }, uuid, session_id }
// `utilization` is OMITTED when the bucket is below the warning threshold and
// PRESENT (0..1) when at/over the threshold. Source: anthropics/claude-code
// issue 50518 (open as of 2026-05-21), confirms the field is conditional.
//
// We treat utilization >= SATURATION_THRESHOLD on a 5h or seven_day bucket as
// a "pause now" signal. The bucket enum is left as an open string union so
// the post-2026-06-15 monthly_agent_sdk bucket name (when Anthropic announces
// it) requires zero code change here.

export type RateLimitBucket =
  | "five_hour"
  | "seven_day"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | (string & Record<never, never>);

export type RateLimitStatus = "allowed" | "warning" | "exceeded";

export interface RateLimitInfo {
  readonly status?: RateLimitStatus;
  readonly resetsAt?: number;
  readonly rateLimitType?: RateLimitBucket;
  readonly utilization?: number;
}

export interface RateLimitEvent {
  readonly type: "rate_limit_event";
  readonly rate_limit_info?: RateLimitInfo;
  readonly uuid?: string;
  readonly session_id?: string;
}

export const DEFAULT_SATURATION_THRESHOLD = 0.85;
const PAUSE_BUCKETS = new Set<string>(["five_hour", "seven_day_opus", "seven_day"]);

export interface SaturationDecision {
  readonly paused: boolean;
  readonly bucket?: string;
  readonly utilization?: number;
  readonly resetsAt?: number;
  readonly reason: string;
}

export function evaluateSaturation(
  ev: RateLimitEvent,
  threshold = DEFAULT_SATURATION_THRESHOLD,
): SaturationDecision {
  const info = ev.rate_limit_info ?? {};
  const bucket = info.rateLimitType ?? "unknown";
  const util = info.utilization;
  if (info.status === "exceeded") {
    return {
      paused: true,
      bucket,
      utilization: util,
      resetsAt: info.resetsAt,
      reason: `bucket=${bucket} status=exceeded`,
    };
  }
  if (typeof util === "number" && PAUSE_BUCKETS.has(bucket) && util >= threshold) {
    return {
      paused: true,
      bucket,
      utilization: util,
      resetsAt: info.resetsAt,
      reason: `bucket=${bucket} utilization=${util.toFixed(3)} >= threshold=${threshold}`,
    };
  }
  return {
    paused: false,
    bucket,
    utilization: util,
    resetsAt: info.resetsAt,
    reason: `bucket=${bucket} below threshold`,
  };
}

export function isRateLimitEvent(message: unknown): message is RateLimitEvent {
  const m = message as { type?: string };
  return m?.type === "rate_limit_event";
}

export interface RateLimitLogEntry {
  readonly ts: string;
  readonly bucket?: string;
  readonly status?: string;
  readonly utilization?: number;
  readonly resetsAt?: number;
  readonly session_id?: string;
}

export function logRateLimitEvent(path: string, ev: RateLimitEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  const info = ev.rate_limit_info ?? {};
  const entry: RateLimitLogEntry = {
    ts: new Date().toISOString(),
    bucket: info.rateLimitType,
    status: info.status,
    utilization: info.utilization,
    resetsAt: info.resetsAt,
    session_id: ev.session_id,
  };
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}
