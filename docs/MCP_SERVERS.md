# MCP servers — recommended configs for power users

claudemax does not bundle MCP servers (they're heavy and use-case-specific). Instead, this doc lists the high-value MCP servers per the [Claude Code plugin marketplace](https://claude.com/plugins) and gives you the exact config to drop into your project's `.claude/settings.json` `mcpServers` block.

The runtime passes `mcpServers` through to `query()` automatically once you add it to settings — no claudemax-side wiring needed.

## How to add an MCP server

```json5
// .claude/settings.json
{
  "mcpServers": {
    "<name>": {
      "command": "<binary>",
      "args": ["<arg1>", "<arg2>"],
      "env": { "<KEY>": "<VALUE>" }
    }
  }
}
```

After adding, restart your Claude Code session. `cmax bg status` does not currently probe MCP server presence — the SDK validates at query time.

## Recommended set for software-engineering power users

### Playwright — browser automation, E2E testing, screenshots

```json
"playwright": {
  "command": "npx",
  "args": ["@playwright/mcp@latest"]
}
```

Use for: visual regression checks during `/goal` runs that touch UI; screenshot evidence for verifyHints (`"verifyHint": "screenshot at /tmp/health.png matches baseline"`); end-to-end test scripting.

### Vercel — deployments, preview URLs, env vars

```json
"vercel": {
  "command": "npx",
  "args": ["@vercel/mcp@latest"],
  "env": { "VERCEL_TOKEN": "vc_***" }
}
```

Use for: claudemax `/ship` skill can promote a Vercel preview; `/audit` can read deployment logs; `/verify` can curl a preview URL as evidence.

### Supabase — database ops, auth, storage, real-time

```json
"supabase": {
  "command": "npx",
  "args": ["@supabase/mcp@latest"],
  "env": {
    "SUPABASE_URL": "https://<project>.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "eyJ***"
  }
}
```

Use for: `/goal` runs that need to run migrations, inspect production schemas, or check RLS policies.

### GitHub — issues, PRs, code search across repos

```json
"github": {
  "command": "npx",
  "args": ["@modelcontextprotocol/server-github@latest"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_***" }
}
```

Use for: `/investigate` skill can search related issues; `/ship` can open PRs; `/audit` can pull PR history for regression context.

### Figma — read design files, extract tokens, sync to code

```json
"figma": {
  "command": "npx",
  "args": ["figma-mcp@latest"],
  "env": { "FIGMA_TOKEN": "figd_***" }
}
```

Use for: front-end `/goal` runs that need to match design tokens; `/verify` can confirm a component matches a Figma frame.

### Slack — surface insights, draft messages, team coordination

```json
"slack": {
  "command": "npx",
  "args": ["@modelcontextprotocol/server-slack@latest"],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-***",
    "SLACK_TEAM_ID": "T***"
  }
}
```

Use for: overnight runs that need to ping a channel on completion (alternative to ntfy.sh); team-coordination commands.

### Postgres — direct query a database without writing SQL by hand

```json
"postgres": {
  "command": "npx",
  "args": ["@modelcontextprotocol/server-postgres@latest", "postgresql://user:pass@host/db"]
}
```

Use for: `/audit` can scan a production DB schema for missing indexes; `/investigate` can correlate logs with row-level data.

## Anti-recommendations

- **Browser MCP servers that scrape arbitrary web pages**: combine with the `no-fake-cite` and `no-phantom-tool-call` dark-patterns hooks before trusting their output. Anything an LLM fetches from the open web is untrusted input.
- **MCP servers that ask for blanket scopes** (`repo`, `admin:*`, write-everything): prefer narrowly-scoped tokens for the same service. The dark-patterns `no-credential-leak-in-handoff` hook will block plaintext tokens, but it can't enforce least-privilege.
- **Self-written MCP servers with `shell` tools**: claudemax's `Bash` tool already covers this. A custom MCP that wraps `bash -c` is duplicating attack surface.

## Strict MCP config

If you want strict MCP validation (no fall-through to project config), set this in your project's `.claude/settings.json`:

```json
{
  "strictMcpConfig": true
}
```

claudemax's runtime passes this through via the `baseSdkOptions` builder. With strict mode, the SDK will only honor the `mcpServers` block in this settings file, not merge with `~/.claude/settings.json`.

## Source of truth

Browse the full catalog at [Claude Code Plugin Marketplace](https://claude.com/plugins) (55+ official plugins) and the broader [MCP Registry](https://github.com/modelcontextprotocol/servers) (5,000+ community servers as of mid-2026).
