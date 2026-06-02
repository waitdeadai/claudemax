// Frontend / subjective-quality verification (§3).
//
// A vague frontend result slips through because there is no MECHANICAL verifyHint
// to fail against — the verifier rubber-stamps. These builders give the verifier
// something to SEE: a real render + a11y-tree assertion (primary, cheap, robust),
// a screenshot capture, and a GRADUABLE design rubric (vague == a low score, not a
// binary pass). The probes run via the existing interactive-verify node runner;
// the rubric score is produced by a VLM-as-judge call and graded here.

import type { InteractiveVerifyHint } from "@claudemax/core";

export interface RubricCriterion {
  readonly key: string;
  readonly weight: number;
  readonly description: string;
}

// Weighted, graduable design rubric (UI-quality). Weights sum to 1.
export const DESIGN_RUBRIC: readonly RubricCriterion[] = [
  { key: "functionality", weight: 0.3, description: "the UI does what the spec says — flows work, nothing dead" },
  { key: "layout", weight: 0.15, description: "spacing, alignment, grid; nothing overlapping or cramped" },
  { key: "responsive", weight: 0.15, description: "holds up at mobile + desktop widths" },
  { key: "hierarchy", weight: 0.15, description: "clear visual hierarchy; the primary action is obvious" },
  { key: "accessibility", weight: 0.15, description: "roles/labels/contrast; keyboard reachable" },
  { key: "craft", weight: 0.1, description: "polish — consistent type scale, hover/focus states, no rough edges" },
];

export interface RubricScore {
  readonly weighted: number; // 0..10
  readonly pass: boolean;
  readonly breakdown: Readonly<Record<string, number>>;
  readonly missing: readonly string[];
}

// Graduable, NOT pass/fail: the weighted mean of per-criterion 0–10 scores. A
// "vague" UI lands a low score, not a hard fail. A missing criterion scores 0 and
// blocks pass (you must grade every dimension). Default threshold 8/10.
export function scoreDesignRubric(
  scores: Readonly<Record<string, number>>,
  passThreshold = 8,
): RubricScore {
  let weighted = 0;
  const breakdown: Record<string, number> = {};
  const missing: string[] = [];
  for (const c of DESIGN_RUBRIC) {
    const raw = scores[c.key];
    if (typeof raw !== "number") missing.push(c.key);
    const s = typeof raw === "number" ? Math.max(0, Math.min(10, raw)) : 0;
    breakdown[c.key] = s;
    weighted += s * c.weight;
  }
  return { weighted, pass: missing.length === 0 && weighted >= passThreshold, breakdown, missing };
}

export interface A11yExpect {
  readonly role: string;
  readonly name?: string;
}

// Build a Playwright a11y-tree probe (the primary frontend verifyHint): navigate,
// fail on console errors, assert the accessibility tree contains the expected
// roles/names. Runs via interactive-verify (`node <script>`). If playwright is not
// installed it exits 1 with PLAYWRIGHT_MISSING — absence is reported, never faked.
export function buildA11yProbe(
  url: string,
  expects: readonly A11yExpect[],
  opts: { timeoutMs?: number } = {},
): InteractiveVerifyHint {
  const script = `
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('PLAYWRIGHT_MISSING: install playwright (or use the Playwright MCP) to run a11y probes'); process.exit(1); }
const expects = ${JSON.stringify(expects)};
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle' });
const snap = await page.accessibility.snapshot();
const flat = [];
(function walk(n){ if(!n) return; flat.push({ role: n.role, name: n.name }); (n.children||[]).forEach(walk); })(snap);
const missing = expects.filter((e) => !flat.some((f) => f.role === e.role && (e.name == null || String(f.name||'').includes(e.name))));
await browser.close();
if (errors.length) { console.error('CONSOLE_ERRORS: ' + errors.slice(0,5).join(' | ')); process.exit(1); }
if (missing.length) { console.error('A11Y_MISSING: ' + JSON.stringify(missing)); process.exit(1); }
console.log('A11Y_OK roles=' + flat.length);
process.exit(0);
`.trim();
  return { tool: "playwright", script, timeoutMs: opts.timeoutMs ?? 60_000, expect: "A11Y_OK" };
}

// Capture a screenshot and gate on console errors. Visual-regression baselines
// (maxDiffPixelRatio) are best done with @playwright/test's toHaveScreenshot in the
// target repo; this probe proves the page renders cleanly and saves the artifact.
export function buildScreenshotProbe(
  url: string,
  outPath: string,
  opts: { timeoutMs?: number } = {},
): InteractiveVerifyHint {
  const script = `
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('PLAYWRIGHT_MISSING: install playwright (or use the Playwright MCP)'); process.exit(1); }
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle' });
await page.screenshot({ path: ${JSON.stringify(outPath)}, fullPage: true });
await browser.close();
if (errors.length) { console.error('CONSOLE_ERRORS: ' + errors.slice(0,5).join(' | ')); process.exit(1); }
console.log('SCREENSHOT_OK ' + ${JSON.stringify(outPath)});
process.exit(0);
`.trim();
  return { tool: "playwright", script, timeoutMs: opts.timeoutMs ?? 60_000, expect: "SCREENSHOT_OK" };
}

export function frontendNote(): string {
  return [
    "Frontend verification uses Playwright via the interactive-verify node runner:",
    "- buildA11yProbe — render + console-error gate + a11y-tree role/name assertions (primary, cheap, robust).",
    "- buildScreenshotProbe — render + screenshot capture; pair with @playwright/test toHaveScreenshot for maxDiffPixelRatio baselines.",
    "- scoreDesignRubric — grade a VLM-as-judge's per-criterion scores (graduable, not pass/fail).",
    "Install `playwright` in the target repo (or use the Playwright MCP). If absent, probes exit 1 with PLAYWRIGHT_MISSING — never a silent pass.",
  ].join("\n");
}
