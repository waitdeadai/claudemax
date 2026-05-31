# vault — claudemax human-canonical ground truth (Tier 3)

Plain markdown in git. This is the **human canonical** layer of the grounding
stack. The Obsidian app is just your editor; nothing at agent runtime depends on
Obsidian being installed. The vault is committed to git (only CODE and these
markdown notes are tracked; `.claudemax/memory.sqlite` is not).

## The one rule: write once, read many

```
machine proposes  →  human blesses  →  compile promotes
```

- **Agents** only ever append dated rows to `.claudemax/memory.sqlite` with
  `status='proposed'` (via `cmax memory propose-decision` / `propose-fact`). They
  never self-bless.
- **You** review proposed rows surfaced into `_inbox/` (by `cmax ground export`),
  edit them, and set `blessed: true`.
- **`cmax ground compile`** promotes every `blessed: true` note in `decisions/`
  and `facts/` into `accepted` sqlite rows, then writes the `invariant: true`
  ones into the `GROUNDING:BEGIN`/`END` managed block in the matching `CLAUDE.md`.

Single logical source, controlled promotion. Two writers drifting is the failure
mode this prevents.

## Layout

| Dir | Contents |
|-----|----------|
| `decisions/` | one ADR per file — what we chose and why. Addressed by `slug`. |
| `facts/` | one small addressable truth per file. Addressed by `key`. |
| `_inbox/` | `cmax ground export` drops agent-proposed rows here for your review. Bless or discard. Never auto-blessed. |
| `_moc/` | maps-of-content — human navigation notes (optional, never compiled). |

## Note frontmatter contract

Compiled by `packages/grounding/src/compile-vault.ts`. Only `blessed: true` notes
are promoted. See the seed notes in `decisions/` and `facts/` for the canonical
shape. Key fields:

- `kind`: `decision` | `fact`
- `slug` (decisions) / `key` (facts): the stable address
- `blessed: true` — the gate. Unset or false → ignored by compile.
- `invariant: true` — promote into the CLAUDE.md managed block.
- `scope`: path glob the truth applies to (`**` = repo-wide).
- `verified_on: YYYY-MM-DD` — informational; compile recomputes `last_verified_at`
  to today on promotion (staleness reads `last_verified_at`, never a cached date).
- `ttl_days`: optional per-row override of the 30-day staleness window.

Staleness is detectable: the `freshness-gate.sh` hook flags accepted invariant
rows past their TTL on SessionStart, and the read-only memory MCP returns
`ageDays` / `stale` on every hit.
