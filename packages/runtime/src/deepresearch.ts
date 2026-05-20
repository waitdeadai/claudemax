import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type ResearchBrief, type ResearchSource } from "@claudemax/core";

export interface DeepResearchOptions {
  readonly cwd?: string;
  readonly maxTurns?: number;
  readonly maxSources?: number;
  readonly currentDateIso?: string;
}

const RESEARCH_JSON_SCHEMA = {
  type: "object",
  required: ["topic", "summary", "keyFindings", "sources", "openQuestions"],
  properties: {
    topic: { type: "string" },
    summary: { type: "string" },
    keyFindings: { type: "array", items: { type: "string" } },
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

Output ONLY a JSON object matching the ResearchBrief schema. No prose, no markdown fences.

Rules:
- sources[].accessedAt MUST be the current date (${now}).
- sources[].relevance: 0–1 (1 = directly answers the topic; 0.5 = adjacent; < 0.3 = drop).
- keyFindings: concise, each citable to ≥ 1 source by URL.
- openQuestions: anything the research did not conclusively answer.`;

export async function deepResearch(
  topic: string,
  opts: DeepResearchOptions = {},
): Promise<ResearchBrief> {
  const now = opts.currentDateIso ?? new Date().toISOString();
  const maxSources = opts.maxSources ?? 12;

  let finalResult = "";

  for await (const message of query({
    prompt: `Topic: ${topic}\n\nReturn the JSON ResearchBrief. Cap sources at ${maxSources}.`,
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
      permissionMode: "default",
      maxTurns: opts.maxTurns ?? 25,
      cwd: opts.cwd,
      settingSources: ["user", "project"],
      outputFormat: { type: "json_schema", schema: RESEARCH_JSON_SCHEMA },
    } as never,
  })) {
    const m = message as { type?: string; result?: string };
    if (m.type === "result" && typeof m.result === "string") finalResult = m.result;
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(finalResult);
  if (!jsonMatch) throw new Error(`deepResearch returned no JSON. Raw:\n${finalResult.slice(0, 500)}`);
  const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

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
    keyFindings: ((obj["keyFindings"] as string[]) ?? []) as readonly string[],
    sources,
    openQuestions: ((obj["openQuestions"] as string[]) ?? []) as readonly string[],
    createdAt: now,
  };
}
