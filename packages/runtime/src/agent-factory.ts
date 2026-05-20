import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelTier } from "@claudemax/core";

export interface AgentDefinitionRecord {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly tier: ModelTier;
  readonly tools: readonly string[];
  readonly createdAt: string;
  readonly version: number;
}

export interface AgentRegistry {
  readonly version: number;
  readonly agents: Readonly<Record<string, AgentDefinitionRecord>>;
}

export class AgentFactoryStore {
  private readonly root: string;

  constructor(cwd: string) {
    this.root = join(cwd, "agents");
    mkdirSync(this.root, { recursive: true });
  }

  registryPath(): string {
    return join(this.root, "registry.json");
  }

  load(): AgentRegistry {
    const path = this.registryPath();
    if (!existsSync(path)) return { version: 1, agents: {} };
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as AgentRegistry;
  }

  save(agent: AgentDefinitionRecord): AgentRegistry {
    const reg = this.load();
    const agents = { ...reg.agents, [agent.name]: agent };
    const next: AgentRegistry = { version: reg.version, agents };
    writeFileSync(this.registryPath(), JSON.stringify(next, null, 2), "utf8");
    writeFileSync(
      join(this.root, `${agent.name}.json`),
      JSON.stringify(agent, null, 2),
      "utf8",
    );
    return next;
  }

  list(): readonly AgentDefinitionRecord[] {
    return Object.values(this.load().agents);
  }

  get(name: string): AgentDefinitionRecord | undefined {
    return this.load().agents[name];
  }
}

export function createAgent(
  cwd: string,
  spec: {
    name: string;
    description: string;
    prompt: string;
    tier?: ModelTier;
    tools?: readonly string[];
  },
): AgentDefinitionRecord {
  const factory = new AgentFactoryStore(cwd);
  const existing = factory.get(spec.name);
  const record: AgentDefinitionRecord = {
    name: spec.name,
    description: spec.description,
    prompt: spec.prompt,
    tier: spec.tier ?? "sonnet",
    tools: spec.tools ?? ["Read", "Glob", "Grep"],
    createdAt: new Date().toISOString(),
    version: existing ? existing.version + 1 : 1,
  };
  factory.save(record);
  return record;
}
