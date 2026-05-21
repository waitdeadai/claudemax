import { availableParallelism, cpus, freemem, loadavg, totalmem } from "node:os";
import type { Plan } from "@claudemax/core";

const RAM_PER_LANE_GB = 1.5;
const LOAD_AVG_BACKPRESSURE_THRESHOLD = 0.8;

export interface HardwareProfile {
  readonly cores: number;
  readonly availableParallelism: number;
  readonly freeMemGB: number;
  readonly totalMemGB: number;
  readonly loadAvg1m: number;
  readonly thermallyConstrained: boolean;
}

export function probeHardware(): HardwareProfile {
  const ap = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  const free = freemem() / 1_073_741_824;
  const total = totalmem() / 1_073_741_824;
  const load = loadavg()[0] ?? 0;
  return {
    cores: cpus().length,
    availableParallelism: ap,
    freeMemGB: Number(free.toFixed(2)),
    totalMemGB: Number(total.toFixed(2)),
    loadAvg1m: Number(load.toFixed(2)),
    thermallyConstrained: load > LOAD_AVG_BACKPRESSURE_THRESHOLD * ap,
  };
}

export const PLAN_LANE_CAP: Readonly<Record<Plan, number>> = {
  max20x: 10,
  max5x: 6,
  pro: 3,
  api: 16,
};

export interface DeriveLanesOptions {
  readonly plan: Plan;
  readonly hardware?: HardwareProfile;
  readonly override?: number;
  readonly ramPerLaneGB?: number;
}

export interface LanesDecision {
  readonly lanes: number;
  readonly bottleneck: "override" | "cores" | "ram" | "plan-cap" | "thermal";
  readonly reason: string;
  readonly hardware: HardwareProfile;
}

// Lane-sizing formula sourced from a 2026-05-21 deepresearch pass:
// floor by min(availableParallelism, freemem_GB / RAM_PER_LANE_GB, PLAN_CAP);
// halve if load-average reports thermal back-pressure. Citations in
// docs/RESUMABLE_CRON.md.
export function deriveLanes(opts: DeriveLanesOptions): LanesDecision {
  const hw = opts.hardware ?? probeHardware();
  const ramPerLane = opts.ramPerLaneGB ?? RAM_PER_LANE_GB;
  if (opts.override != null && opts.override > 0) {
    return {
      lanes: opts.override,
      bottleneck: "override",
      reason: `--max-parallel=${opts.override}`,
      hardware: hw,
    };
  }
  const ramLanes = Math.max(1, Math.floor(hw.freeMemGB / ramPerLane));
  const coreLanes = Math.max(1, hw.availableParallelism);
  const planCap = PLAN_LANE_CAP[opts.plan];
  const candidates = [
    { value: coreLanes, label: "cores" as const },
    { value: ramLanes, label: "ram" as const },
    { value: planCap, label: "plan-cap" as const },
  ];
  let bottleneck: LanesDecision["bottleneck"] = "cores";
  let lanes = candidates[0]!.value;
  for (const c of candidates) {
    if (c.value < lanes) {
      lanes = c.value;
      bottleneck = c.label;
    }
  }
  if (hw.thermallyConstrained) {
    const halved = Math.max(1, Math.floor(lanes / 2));
    if (halved < lanes) {
      return {
        lanes: halved,
        bottleneck: "thermal",
        reason: `thermal back-pressure (loadavg1m=${hw.loadAvg1m} > ${LOAD_AVG_BACKPRESSURE_THRESHOLD}×ap=${hw.availableParallelism}); halved ${lanes}→${halved}`,
        hardware: hw,
      };
    }
  }
  return {
    lanes,
    bottleneck,
    reason: `min(cores=${coreLanes}, ram=${ramLanes}, plan-${opts.plan}=${planCap}) → ${lanes} via ${bottleneck}`,
    hardware: hw,
  };
}
