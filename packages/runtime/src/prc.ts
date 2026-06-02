// Production-Readiness Contract (§2-bis "el bar es el bug").
//
// The over-claiming failure isn't only a weak verifier — it's a weak BAR. If the
// completion conditions encode "works", the agent satisfies "works" and is
// genuinely done by that low bar. The fix is to bake production-readiness in as
// the DEFAULT: multispec decompose auto-appends these conditions (each with a
// mechanically-checkable verifyHint) to every sub-Spec + the rollup, so the
// decomposed verifier (and /specqa) enforce them. MVP becomes the explicit
// opt-out (--mvp), never the default.

import type { MultiSpec, Spec, SpecCompletionCondition } from "@claudemax/core";

export const PRC_PREFIX = "prc-";

export const PRC_CONDITIONS: readonly SpecCompletionCondition[] = [
  {
    id: "prc-no-stubs",
    description:
      "No stub/TODO/FIXME/placeholder/NotImplemented markers in changed production source (tests/docs exempt).",
    verifyHint:
      "grep the diff of changed non-test source for TODO|FIXME|XXX|HACK|NotImplemented|placeholder|# stub — finds none (the cmax stub gate passes).",
  },
  {
    id: "prc-error-handling",
    description:
      "Inputs are validated and failure paths fail gracefully — no unhandled exceptions, no swallowed errors.",
    verifyHint:
      "a failure-mode test feeds invalid/empty/boundary input and asserts a graceful, defined outcome (not a crash, not a silently swallowed error).",
  },
  {
    id: "prc-edge-cases",
    description: "Behavior covers edge/boundary cases, not only the happy path.",
    verifyHint:
      "the test suite includes >=1 edge/boundary case (empty, max, null, concurrent, error) beyond the happy path for the changed behavior.",
  },
  {
    id: "prc-no-regressions",
    description: "Existing tests remain green; no regressions introduced.",
    verifyHint: "the project's full test command exits 0 (e.g. `pnpm -r test`, or the repo's documented runner).",
  },
  {
    id: "prc-types-lint",
    description: "Types, lint, and format are clean for the changed code.",
    verifyHint: "the project's typecheck + lint commands exit 0 (e.g. `pnpm -r typecheck`).",
  },
  {
    id: "prc-integration",
    description:
      "Wired end-to-end — the new behavior is reachable from a real entry point, not an isolated island.",
    verifyHint:
      "a call path from an existing entry point (CLI command, route, exported API) to the new code exists and is exercised by an integration/e2e check.",
  },
];

const PRC_IDS = new Set(PRC_CONDITIONS.map((c) => c.id));

export function isPRCCondition(cc: SpecCompletionCondition): boolean {
  return PRC_IDS.has(cc.id);
}

// Append the PRC conditions not already present (idempotent). Returns a new Spec.
export function augmentSpecWithPRC(spec: Spec): Spec {
  const have = new Set(spec.completionConditions.map((c) => c.id));
  const additions = PRC_CONDITIONS.filter((c) => !have.has(c.id));
  if (additions.length === 0) return spec;
  return { ...spec, completionConditions: [...spec.completionConditions, ...additions] };
}

export interface PRCAugmentOptions {
  // Opt out of the production-ready bar (MVP is the explicit exception, not the default).
  readonly mvp?: boolean;
}

// Augment every sub-Spec + the rollup conditions with the PRC bar. --mvp opts out
// (returns the multispec unchanged).
export function augmentMultiSpecWithPRC(
  multispec: MultiSpec,
  opts: PRCAugmentOptions = {},
): MultiSpec {
  if (opts.mvp) return multispec;
  const haveRollup = new Set(multispec.rollupCompletionConditions.map((c) => c.id));
  const rollupAdds = PRC_CONDITIONS.filter((c) => !haveRollup.has(c.id));
  return {
    ...multispec,
    subSpecs: multispec.subSpecs.map(augmentSpecWithPRC),
    rollupCompletionConditions: [...multispec.rollupCompletionConditions, ...rollupAdds],
  };
}
