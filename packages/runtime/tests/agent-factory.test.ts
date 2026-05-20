import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentFactoryStore, createAgent } from "../src/agent-factory.js";

describe("AgentFactory", () => {
  it("round-trips a single agent through the registry", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmax-agentfactory-"));
    try {
      const agent = createAgent(cwd, {
        name: "code-reviewer",
        description: "Reviews diffs for taste",
        prompt: "Review the diff",
        tier: "opus",
        tools: ["Read", "Grep"],
      });
      expect(agent.version).toBe(1);

      const store = new AgentFactoryStore(cwd);
      const got = store.get("code-reviewer");
      expect(got?.name).toBe("code-reviewer");
      expect(got?.tier).toBe("opus");
      expect(got?.tools).toEqual(["Read", "Grep"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("bumps version on re-save with same name", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmax-agentfactory-"));
    try {
      const v1 = createAgent(cwd, {
        name: "migration-runner",
        description: "Runs migrations",
        prompt: "Run pending migrations",
      });
      expect(v1.version).toBe(1);

      const v2 = createAgent(cwd, {
        name: "migration-runner",
        description: "Runs migrations safely",
        prompt: "Run pending migrations with dry-run preview",
      });
      expect(v2.version).toBe(2);

      const store = new AgentFactoryStore(cwd);
      expect(store.get("migration-runner")?.version).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("list() returns all agents in the registry", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmax-agentfactory-"));
    try {
      createAgent(cwd, { name: "a", description: "x", prompt: "y" });
      createAgent(cwd, { name: "b", description: "x", prompt: "y" });
      createAgent(cwd, { name: "c", description: "x", prompt: "y" });

      const all = new AgentFactoryStore(cwd).list();
      expect(all.map((a) => a.name).sort()).toEqual(["a", "b", "c"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("defaults tier=sonnet and tools=[Read, Glob, Grep]", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cmax-agentfactory-"));
    try {
      const a = createAgent(cwd, { name: "minimal", description: "x", prompt: "y" });
      expect(a.tier).toBe("sonnet");
      expect(a.tools).toEqual(["Read", "Glob", "Grep"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
