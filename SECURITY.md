# Security policy

claudemax runs autonomous AI agents that read your filesystem, run shell commands, edit files, fetch web pages, and spawn parallel subprocesses. Treat it accordingly.

## Threat model — what claudemax does and doesn't do

| Action | Default behavior |
|---|---|
| Read files in your project | Yes, every umbrella reads the project |
| Edit files in your project | Yes, with `permissionMode: 'acceptEdits'` by default for `cmax run` and `cmax goal` |
| Run shell commands | Yes — via Claude Code's `Bash` tool, gated by Claude Code's permission system |
| Network calls | Yes — `WebSearch`, `WebFetch`, and outbound to the Anthropic API |
| Spawn parallel processes | Yes in Mode B (Agent Teams) — each teammate is a separate `claude` subprocess writing to its own worktree under `.claude/worktrees/<session-id>/` |
| Persist data outside your project | Yes — `~/.claudemax-state/config.json` (NTFY_TOPIC + install dir), `.claudemax/memory.sqlite` (per-project SQLite memory) |
| Send data to third parties | If you enable ntfy push (opt-in via `NTFY_TOPIC`), one-line notifications go to your configured ntfy server (default `ntfy.sh`) on every run completion |
| Use your Anthropic API key | Only if `ANTHROPIC_API_KEY` is set; otherwise claudemax routes through `@anthropic-ai/claude-agent-sdk` which bills against your Claude Max Agent SDK credit pool |
| Auto-commit to git | No — claudemax never commits without your explicit request |
| Push to remotes | No |
| Modify your global git config | No |

## Hardening checklist for production / sensitive repos

1. **Inspect `setup.sh` before piping to bash.** It auto-installs tmux / qrencode / Tailscale via official package managers and downloads the official Tailscale install script. Review the file first.
2. **Pin Claude Code version** if you're on the Mode B Agent Teams experimental path — the API may shift.
3. **Use `--permission default`** (not `acceptEdits`) on `cmax run` / `cmax goal` when working in a repo where automated edits are risky. You'll have to approve each edit interactively.
4. **Run claudemax inside a dev container or VM** for untrusted goals. claudemax can read anything in the working directory, including files containing secrets.
5. **Set `CMAX_PLAN=api` and use a scoped API key** if you want strict cost control via Anthropic dashboard.
6. **Use the `cmax doctor` budget guard** — at > 90% of monthly Agent SDK credit, the router auto-demotes Opus → Sonnet for non-verify/non-spec packets. At > 95%, `cmax run` requires `--force`.
7. **Install the dark-patterns hooks** (`waitdeadai/llm-dark-patterns`) — the `no-credential-leak-in-handoff` hook blocks plaintext `sk-*` / `ghp_*` / AWS keys in agent task payloads, and `no-approval-sneak` blocks unapproved edits to sensitive paths (`.env*`, `secrets/`, `.kube/`, `terraform/state/`, `.ssh/`, `.gnupg/`, `prod/`).

## What claudemax does NOT cover (your responsibility)

- **Sandbox isolation** — claudemax does not run goals in a sandbox by default. Mode B uses Claude Code worktrees for write isolation, but reads are unconstrained. For untrusted code, run claudemax inside a Vercel Sandbox / Firecracker microVM / Docker container.
- **API key rotation** — if you commit an API key by accident, claudemax can't recover it for you. Use the dark-patterns `no-credential-leak-in-handoff` hook to catch this before push.
- **Network egress filtering** — claudemax doesn't restrict outbound calls. Use a network policy or proxy if you need to limit egress.
- **Prompt-injection from fetched web pages** — `/deepresearch` and `/audit` fetch URLs via `WebFetch`. Pages can contain prompt-injection payloads. The dark-patterns hooks help (especially `no-phantom-tool-call` and `no-fake-cite`), but a determined attacker can craft adversarial content. Treat anything claudemax surfaces from the web as untrusted input.

## Reporting a vulnerability

If you find a security issue in claudemax itself (not in a third-party dependency, not in Claude Code, not in Anthropic's API):

1. **Do not** open a public GitHub issue.
2. Email the maintainer privately (see the GitHub repo for the current contact address).
3. Include: reproduction steps, claudemax version (`cmax --version`), Node version, OS, and any logs from `~/.claudemax-state/` or the project's `.claudemax/state/`.
4. Allow up to 90 days for a fix before public disclosure.

For vulnerabilities in dependencies (Claude Code, `@anthropic-ai/claude-agent-sdk`, Tailscale, ntfy, etc.), report upstream to the respective project.

## Supply chain

claudemax depends on:

- `@anthropic-ai/claude-agent-sdk` (Anthropic, official)
- `better-sqlite3` (native bindings, compiled at install time)
- `commander`, `kleur`, `zod` (small, well-known)
- `tmux` / `qrencode` / `tailscale` (system packages; only installed via official package managers when you run `setup.sh`)

Native compilation happens at `pnpm install` time via the `allowBuilds: { better-sqlite3: true, esbuild: true }` opt-in in `pnpm-workspace.yaml`. Inspect `pnpm-lock.yaml` before installing if you need to audit the dependency tree.
