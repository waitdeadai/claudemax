import { existsSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type KeyFinding, type ResearchBrief, type ResearchSource } from "@claudemax/core";
import { MemoryStore, type ResearchSourceRecord } from "@claudemax/memory";
import { extractStructuredOutput } from "./sdk-options.js";

export interface DeepResearchOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly maxSources?: number;
  readonly currentDateIso?: string;
  readonly memoryPath?: string;
  readonly memoryFirst?: boolean;
}

const PRIOR_RESEARCH_MAX_AGE_DAYS = 7;
const PRIOR_RESEARCH_FRESH_WINDOW_DAYS = 7;
const PRIOR_RESEARCH_MAX_ROWS = 12;

const RESEARCH_JSON_SCHEMA = {
  type: "object",
  required: ["topic", "summary", "keyFindings", "sources", "openQuestions"],
  properties: {
    topic: { type: "string" },
    summary: { type: "string" },
    keyFindings: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "sourceUrls"],
        properties: {
          finding: { type: "string" },
          sourceUrls: { type: "array", items: { type: "string" }, minItems: 1 },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "title", "accessedAt", "relevance", "excerpt"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          publishedAt: { type: "string" },
          accessedAt: { type: "string" },
          relevance: { type: "number" },
          excerpt: { type: "string" },
        },
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
  },
} as const;

const RESEARCH_SYSTEM = (now: string) => `You are the claudemax deep research agent. The current date is ${now}. Today's facts matter — do NOT rely on training-cutoff knowledge for time-sensitive claims.

Process:
1. Decompose the topic into 3–8 sub-queries.
2. Run WebSearch and WebFetch in parallel across the sub-queries (the SDK runs your tool calls concurrently when you issue multiple in one turn).
3. Read primary sources first (official docs, vendor announcements, RFCs, repos). De-prioritize SEO blogspam.
4. Resolve conflicts by citing the most recent authoritative source.
5. For every claim in your final brief, attach at least one source URL.
6. If the prompt was seeded with "PRIOR RESEARCH (from memory ledger)", treat those rows as a head-start — re-verify any item tagged "possibly stale" against a fresh fetch before citing, and do NOT duplicate fetches for items already covered.

Output ONLY a JSON object matching the ResearchBrief schema. No prose, no markdown fences.

Rules:
- sources[].accessedAt MUST be the current date (${now}).
- sources[].relevance: 0–1 (1 = directly answers the topic; 0.5 = adjacent; < 0.3 = drop).
- Each keyFinding MUST cite at least one sourceUrl drawn from sources[].url; sourceUrls is required and non-empty. If a finding cannot be cited to at least one source URL, DROP it entirely — do not emit uncitable findings.
- openQuestions: anything the research did not conclusively answer.`;

function buildPriorResearchPreamble(
  rows: readonly ResearchSourceRecord[],
  nowIso: string,
): string {
  if (rows.length === 0) return "";
  const freshCutoffMs =
    new Date(nowIso).getTime() - PRIOR_RESEARCH_FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lines: string[] = ["", "PRIOR RESEARCH (from memory ledger):"];
  for (const r of rows) {
    let stale = false;
    if (r.publishedAt) {
      const pubMs = Date.parse(r.publishedAt);
      if (Number.isFinite(pubMs) && pubMs < freshCutoffMs) stale = true;
    }
    const marker = stale ? " [possibly stale]" : "";
    const title = r.title || r.url;
    const excerpt = r.excerpt ? ` — ${r.excerpt}` : "";
    lines.push(`- ${title}${marker} (${r.url})${excerpt}`);
  }
  lines.push(
    "Use these as a head-start: re-verify any [possibly stale] item, and avoid re-fetching pages already covered.",
  );
  return lines.join("\n");
}

function loadPriorResearch(
  topic: string,
  opts: DeepResearchOptions,
): readonly ResearchSourceRecord[] {
  const path = opts.memoryPath ?? join(opts.cwd ?? ".", ".claudemax", "memory.sqlite");
  if (!existsSync(path)) return [];
  let store: MemoryStore | null = null;
  try {
    store = new MemoryStore({ path });
    return store.recentResearchSourcesForTopic(
      topic,
      PRIOR_RESEARCH_MAX_AGE_DAYS,
      PRIOR_RESEARCH_MAX_ROWS,
    );
  } catch {
    return [];
  } finally {
    if (store) {
      try {
        store.close();
      } catch {
        /* non-fatal */
      }
    }
  }
}

export async function deepResearch(
  topic: string,
  opts: DeepResearchOptions = {},
): Promise<ResearchBrief> {
  const now = opts.currentDateIso ?? new Date().toISOString();
  const maxSources = opts.maxSources ?? 12;
  const memoryFirst = opts.memoryFirst !== false;

  const priorRows = memoryFirst ? loadPriorResearch(topic, opts) : [];
  const priorPreamble = buildPriorResearchPreamble(priorRows, now);

  const userPrompt =
    `Topic: ${topic}\n\nReturn the JSON ResearchBrief. Cap sources at ${maxSources}.` +
    (priorPreamble ? `\n${priorPreamble}` : "");

  let finalResult = "";
  let structured: Record<string, unknown> | null = null;

  for await (const message of query({
    prompt: userPrompt,
    options: {
      model: MODELS.opus.id,
      fallbackModel: MODELS.sonnet.id,
      effort: "max",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: RESEARCH_SYSTEM(now),
      },
      allowedTools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      maxTurns: opts.maxTurns ?? 25,
      cwd: opts.cwd,
      settingSources: ["user", "project"],
      outputFormat: { type: "json_schema", schema: RESEARCH_JSON_SCHEMA },
    } as never,
  })) {
    if (!structured) structured = extractStructuredOutput(message);
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") finalResult = m.result;
  }

  let obj: Record<string, unknown>;
  if (structured) {
    obj = structured;
  } else {
    const jsonMatch = /\{[\s\S]*\}/.exec(finalResult);
    if (!jsonMatch) throw new Error(`deepResearch returned no JSON. Raw:\n${finalResult.slice(0, 500)}`);
    obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }

  const sources: ResearchSource[] = ((obj["sources"] as unknown[]) ?? []).map((s) => {
    const sr = s as Record<string, unknown>;
    return {
      url: String(sr["url"] ?? ""),
      title: String(sr["title"] ?? ""),
      publishedAt: sr["publishedAt"] ? String(sr["publishedAt"]) : undefined,
      accessedAt: String(sr["accessedAt"] ?? now),
      relevance: Number(sr["relevance"] ?? 0),
      excerpt: String(sr["excerpt"] ?? ""),
    };
  });

  return {
    topic: (obj["topic"] as string) ?? topic,
    summary: (obj["summary"] as string) ?? "",
    keyFindings: (((obj["keyFindings"] as unknown[]) ?? []).map((kf) => {
      if (typeof kf === "string") return { finding: kf, sourceUrls: [] } satisfies KeyFinding;
      const o = (kf ?? {}) as Record<string, unknown>;
      const urls = Array.isArray(o["sourceUrls"]) ? (o["sourceUrls"] as unknown[]) : [];
      return {
        finding: String(o["finding"] ?? ""),
        sourceUrls: urls.map((u) => String(u)),
      } satisfies KeyFinding;
    })) as readonly KeyFinding[],
    sources,
    openQuestions: ((obj["openQuestions"] as string[]) ?? []) as readonly string[],
    createdAt: now,
  };
}
