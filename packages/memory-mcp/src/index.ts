#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { MemoryDbMissingError, openReadOnlyDb, resolveDbPath } from "./db.js";
import {
  getDecision,
  getFact,
  searchGrounding,
  staleTruth,
  type GroundingKind,
} from "./queries.js";

const SERVER_NAME = "claudemax-memory-mcp";
const SERVER_VERSION = "0.2.2";

// stdio discipline: stdout is reserved for JSON-RPC. ALL diagnostics → stderr.
// A console.log anywhere in this package corrupts the protocol stream.
function logErr(msg: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Lazily resolves a read-only DB handle. The server still starts when the DB is
// absent (nothing grounded yet); each tool then returns a soft error instead of
// crashing the transport.
function createDbProvider(): () => Database.Database {
  const path = resolveDbPath();
  let handle: Database.Database | null = null;
  return () => {
    if (handle) return handle;
    handle = openReadOnlyDb(path).db;
    return handle;
  };
}

const KIND_VALUES = ["decision", "fact", "fix", "all"] as const;

export function buildServer(getDb: () => Database.Database): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const guard = (fn: (db: Database.Database) => CallToolResult): CallToolResult => {
    try {
      return fn(getDb());
    } catch (e) {
      if (e instanceof MemoryDbMissingError) return fail(e.message);
      const msg = e instanceof Error ? e.message : String(e);
      logErr(`tool error: ${msg}`);
      return fail(`${SERVER_NAME}: ${msg}`);
    }
  };

  server.registerTool(
    "memory_search",
    {
      title: "Search grounding memory",
      description:
        "Ranked full-text search across project decisions, project_facts, and recorded error/fix pairs in the claudemax memory store. " +
        "Args: query (string, required), kind ('decision'|'fact'|'fix'|'all', default 'all'), scope (optional path glob), limit (1-25, default 8). " +
        "Each hit carries ageDays and a stale boolean — treat stale rows as assumptions and re-verify before relying on them. " +
        "There is deliberately no dump-all: pass a real query and keep the slice small.",
      inputSchema: {
        query: z.string().min(1),
        kind: z.enum(KIND_VALUES).optional(),
        scope: z.string().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    (args) =>
      guard((db) =>
        ok(
          searchGrounding(
            db,
            args.query,
            (args.kind ?? "all") as GroundingKind,
            args.scope,
            args.limit ?? 8,
          ),
        ),
      ),
  );

  server.registerTool(
    "memory_get_decision",
    {
      title: "Get an accepted decision by slug",
      description:
        "Fetch the single most-recent accepted decision addressed by its stable slug (e.g. 'anthropic-only'). " +
        "Args: slug (string, required). Returns the full decision (topic, decision, rationale, scope, invariant, tags) plus ageDays and a stale boolean, " +
        "or null when no accepted decision matches. A stale decision is an assumption — re-verify before relying on it.",
      inputSchema: {
        slug: z.string().min(1),
      },
    },
    (args) => guard((db) => ok(getDecision(db, args.slug))),
  );

  server.registerTool(
    "memory_get_fact",
    {
      title: "Get the best project fact for a key",
      description:
        "Resolve an addressable project fact by key (e.g. 'db.migrations.tool'), choosing the most-specific scope glob that matches the optional querying scope. " +
        "Args: key (string, required), scope (optional path the fact applies at, e.g. 'packages/auth/login.ts'). " +
        "Returns the fact (value, scope, confidence, source, invariant, tags) plus ageDays and a stale boolean, or null when no accepted fact matches. " +
        "Treat a stale fact as an assumption and re-verify.",
      inputSchema: {
        key: z.string().min(1),
        scope: z.string().optional(),
      },
    },
    (args) => guard((db) => ok(getFact(db, args.key, args.scope))),
  );

  server.registerTool(
    "memory_stale",
    {
      title: "List stale ground-truth invariants",
      description:
        "List accepted invariant decisions and facts whose age exceeds their staleness window (ttl_days override, else the 30-day default). " +
        "Args: scope (optional path glob filter). Returns [{ kind, ref, addressable, ageDays, ttlDays }] — these are ground-truth items past their verify-by date; " +
        "treat them as assumptions and re-verify before relying on them.",
      inputSchema: {
        scope: z.string().optional(),
      },
    },
    (args) => guard((db) => ok(staleTruth(db, args.scope))),
  );

  return server;
}

async function main(): Promise<void> {
  const server = buildServer(createDbProvider());
  const transport = new StdioServerTransport();

  // A client disconnect can surface as EPIPE on the stdout stream; exit cleanly
  // rather than crashing with an unhandled error.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    logErr(`stdout error: ${err.message}`);
    process.exit(0);
  });

  await server.connect(transport);
  logErr(`ready (db: ${resolveDbPath()})`);
}

// Only start the stdio server when run as the binary entry point. Importing this
// module (e.g. from tests) must not connect a transport.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((e) => {
    logErr(`fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
