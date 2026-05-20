# Add /health endpoint

> Created: 2026-05-20T18:30:00Z

## Goal
Add a GET /health endpoint to the server that returns `{ ok: true, sha: <git sha>, uptimeMs: <number> }`. Cover it with one passing test.

## Completion conditions
1. **endpoint-exists** — A handler for GET /health is registered and returns 200.
   - Verify: `grep -R "/health" src/` shows the route registration.
2. **payload-shape** — Response body is JSON with keys `ok` (true), `sha` (string), `uptimeMs` (number).
   - Verify: `curl -s localhost:3000/health` returns those three keys with those types.
3. **test-passes** — A unit/integration test for the endpoint passes.
   - Verify: `pnpm test --filter health` exits 0.

## Non-goals
- Authentication on the endpoint.
- Rich health diagnostics (DB ping, queue depth) — just liveness.

## Constraints
- No new dependencies.
- Existing route handlers must keep working.

## Assumptions
- The project uses a Node HTTP server framework already.
- `git` is available at runtime for sha lookup.

## Evidence required
- Diff of the route registration.
- Output of `curl -s localhost:3000/health`.
- Output of `pnpm test --filter health`.
