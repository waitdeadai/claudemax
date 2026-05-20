# Remote operation — phone, secondary notebook, voice

Three independent paths, each with sourced 2026 evidence. They compose: you can run all three at once.

| Goal | Best path |
|---|---|
| Full terminal control from phone or 2nd notebook | **Tailscale + SSH client + tmux** (gold standard per the 2026 community consensus) |
| Lighter UX, browser or Claude mobile app | **Anthropic Remote Control** (Feb 2026 research preview) |
| Voice operation while walking with headphones | **Phone-side dictation → SSH typing OR Claude Code `/voice`** (push-to-talk shipped March 2026) |
| 5+ parallel projects with independent contexts | **Tailscale + tmux N windows OR N Remote Control sessions on N Claude Code instances** |

## Path A — Tailscale + SSH client + tmux (full terminal control)

Per [Sealos 2026 mobile guide](https://sealos.io/blog/claude-code-on-phone/), [Pete Sena's iPhone setup on Medium](https://petesena.medium.com/how-to-run-claude-code-from-your-iphone-using-tailscale-termius-and-tmux-2e16d0e5f68b), and [Titus Soporan's remote AI dev with Tailscale SSH](https://tsoporan.com/blog/remote-ai-development-claude-code-tailscale/), this is what experienced developers use.

### Components

| Layer | Tool | Why |
|---|---|---|
| Mesh VPN | [Tailscale](https://tailscale.com) | WireGuard-based; phone + PC see each other directly with no port forwarding, no jump host, no firewall rules. Free tier is generous. |
| SSH client (iPhone) | [Termius](https://termius.com) or [Blink Shell](https://blink.sh) | Termius free tier works; Blink is paid but better keyboard handling. |
| SSH client (Android) | Termius, [JuiceSSH](https://juicessh.com), or Termux (lets you run claudemax natively too) | Termux is the most powerful — runs Linux userland directly. |
| Persistent session | [tmux](https://github.com/tmux/tmux) | Critical — keeps claudemax alive when phone connection drops. Reattach with `tmux a -t <name>`. |
| Push notifications | [ntfy.sh](https://ntfy.sh) | Free, self-hostable; from `cmax-stop.sh` hook, `curl -d "done" ntfy.sh/<topic>`. Per [Rogs' "Claude Code from the beach"](https://rogs.me/2026/02/claude-code-from-the-beach-my-remote-coding-setup-with-mosh-tmux-and-ntfy/). |

### One-time setup on PC

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                                  # auth in browser
sudo apt install tmux                              # if not already
echo 'set -g mouse on' >> ~/.tmux.conf             # convenient on mobile
```

### One-time setup on phone

1. Install Tailscale (App Store / Play Store) → sign in with the same account.
2. Install Termius (or Blink / JuiceSSH).
3. Add a host: hostname = your PC's Tailscale name (e.g., `pcfer.tail-scale.ts.net`), user = your Linux user, key auth (paste public key from PC's `~/.ssh/`).

### Daily use — 5+ parallel projects, one tmux window per project

```bash
# On PC (once):
tmux new-session -d -s claudemax     # named session
tmux rename-window -t claudemax:0 'project-a'
tmux new-window  -t claudemax -n 'project-b'
tmux new-window  -t claudemax -n 'project-c'
tmux new-window  -t claudemax -n 'project-d'
tmux new-window  -t claudemax -n 'project-e'

# Switch into a window, change to that project's dir, run cmax:
tmux send-keys -t claudemax:project-a "cd ~/work/proj-a && cmax run 'your goal'" C-m
# Repeat for each project.
```

From phone via Termius over Tailscale:

```bash
ssh you@pcfer.tail-scale.ts.net -t "tmux a -t claudemax"
# Ctrl-b then 0/1/2/3/4 to switch between project windows.
# Detach with Ctrl-b then d. Session survives.
```

Per the [Stratega "Train" experiment](https://stratega.co/blog/claude-code-iphone-mobile/) and [Skeptrune's Termux+Tailscale guide](https://www.skeptrune.com/posts/claude-code-on-mobile-termux-tailscale/), this works on cellular data, tolerates connection drops, and survives phone restarts.

### Why this is the right path for 5+ parallel projects

- One tmux window per project → claudemax sees its own working directory and `.claudemax/state/` per project.
- Mode A (SDK subagents in one `query()`) for each project works inside its window.
- Mode B (Claude Code Agent Teams) works inside any one window for swarm work on a single big project.
- You can have 5 claudemax instances running 5 different multispec pipelines simultaneously; total parallel sub-agents = 5 × cap-per-instance.
- Anthropic's [Remote Control limitation](https://code.claude.com/docs/en/remote-control) of one remote session per Claude Code instance does NOT apply here — you're SSH'd into native terminals, not using Remote Control's browser bridge.

## Path B — Anthropic Remote Control (lighter UX)

Per [Anthropic's docs](https://code.claude.com/docs/en/remote-control), [Help Net Security Feb 2026](https://www.helpnetsecurity.com/2026/02/25/anthropic-remote-control-claude-code-feature/), and [DevOps.com analysis](https://devops.com/claude-code-remote-control-keeps-your-agent-local-and-puts-it-in-your-pocket/).

### What it does

- Bridges your local Claude Code terminal session with claude.ai/code, the Claude iOS app, and the Claude Android app.
- Code stays local; phone is a thin client. Nothing moves to the cloud.
- Auto-reconnects on network drops / sleep within ~10 minutes.
- Local MCP servers, tools, project config all remain available.

### Setup

On PC, inside a Claude Code session: trigger Remote Control (per current docs — flag varies). Anthropic emits a session URL + QR code. Open the URL in any browser or scan the QR with the Claude mobile app.

### Limitations (load-bearing for your use case)

- **One remote session per Claude Code instance.** For 5 parallel projects you need 5 Claude Code instances running on PC, each independently remote-controlled.
- The terminal must remain open for Remote Control to work.
- ~10 minute network-down timeout.

### When Path B beats Path A

- You want native Claude iOS/Android app UI (touch-friendly, no SSH client to configure).
- You don't want to manage tmux windows.
- You're operating a single project from your phone, not 5.

### When Path B is worse than Path A

- 5+ projects → Path A's tmux is cleaner.
- You want to drop into a raw shell occasionally → Path A gives you that for free; Path B is a Claude Code surface only.
- You don't trust the ~10-minute timeout for very long runs → Path A's tmux survives indefinitely.

## Path C — Voice operation

Two distinct primitives, both 2026-shipped.

### C1 — Claude Code native `/voice` (push-to-talk)

Per [Weesper Neon Flow's Claude Code Voice Mode Guide (March 2026)](https://weesperneonflow.ai/en/blog/2026-03-14-claude-code-voice-mode-developers-dictation-coding/) and [buildmvpfast's hands-free programming guide](https://www.buildmvpfast.com/blog/claude-voice-mode-hands-free-programming):

- Claude Code shipped `/voice` push-to-talk on **3 March 2026**.
- Hold spacebar, describe what you need, release to send.
- Requires being at the terminal (the spacebar is the trigger).

**Implication for walking-with-headphones**: `/voice` on its own does NOT cover this. You're not at a keyboard when walking.

### C2 — System-wide dictation feeding into your SSH session

Per [Ryan Shrott's 2026 comparison](https://medium.com/@ryanshrott/best-voice-dictation-tools-for-developers-in-2026-dictaflow-vs-wispr-flow-vs-superwhisper-edc75f70de9c) and [Wispr Flow + Claude integration](https://wisprflow.ai/use-cases/claude):

| Tool | Where | Cost | Privacy |
|---|---|---|---|
| Wispr Flow | macOS / Windows | Subscription | Cloud transcription |
| Weesper Neon Flow | macOS / Linux | €5/mo | On-device (Whisper) |
| Superwhisper | macOS | Subscription | On-device option |
| iOS native dictation | iPhone (free, built-in) | Free | Apple servers |

**Pipeline for walking-with-headphones + 5 parallel projects:**

1. Phone in pocket, headphones in.
2. Termius SSH session open in background (Tailscale keeps the connection alive while screen is off, with iOS keepalive — confirm per Termius settings).
3. Tap-talk via iOS native dictation OR a third-party dictation app like Wispr Flow on phone.
4. Dictated text lands in Termius's input → SSH → tmux → claudemax.
5. ntfy.sh push notification when claudemax finishes a multispec run → phone vibrates.

This is awkward — you can't easily "talk to claudemax in a call". The closest thing is:
- Speech → dictation → typed prompt → SSH → claudemax run → push notification on completion.

### What does NOT exist as of 2026-05-20 (per the searches above)

- No "voice phone call with Claude Code" interface where you talk and it talks back in real-time during a walk. The Anthropic Claude mobile app has voice chat with Claude (the chatbot) but that is NOT Claude Code — it can't drive your local agent loop.
- No native phone-side "always listening" Claude Code interface.

If you genuinely want "talk while walking" with claudemax as the executor, the practical 2026 setup is:
1. Use the Anthropic Claude mobile app's voice mode for ideation / spec drafting (chat with Claude).
2. Then ask the chat Claude to write a precise `cmax run "<goal>"` invocation.
3. Dictate that invocation into Termius via SSH over Tailscale.
4. ntfy.sh push when done.

## Recommended stack for your stated use case

You said: 5+ parallel instances on different projects + walking + headphones + keep track.

**Primary stack:**

1. **Tailscale** on PC + phone (mesh VPN, free)
2. **Termius** (iPhone) or **Termux** (Android) as SSH client
3. **tmux** on PC, one window per project — gives you 5+ parallel claudemax instances each with their own state
4. **ntfy.sh** wired into claudemax's `cmax-stop.sh` hook for push notifications on completion
5. **iOS / Android native dictation** for typing prompts while walking
6. Optional: **Wispr Flow** or **Weesper Neon Flow** on PC for faster local dictation when at the desk

**Secondary stack (lighter, 1 project at a time):**

1. **Anthropic Remote Control** (start the session on PC, scan QR with Claude mobile app)
2. Native voice in the Claude app for ideation
3. Use the Claude app to draft `cmax run` invocations, then trigger via Remote Control

## Hardening the claudemax-stop hook to push notifications

Add to `.claude/hooks/cmax-stop.sh` (only if you set `NTFY_TOPIC`):

```bash
if [ -n "${NTFY_TOPIC:-}" ]; then
  curl -fsS -d "$(basename "$CMAX_ROOT") run finished at $TS" \
    "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1 || true
fi
```

Then `export NTFY_TOPIC=cmax-fer-2026` in your shell, subscribe to `cmax-fer-2026` in the ntfy iOS/Android app. Walks become productive.

## Sources

- [Sealos: Claude Code Mobile iPhone/Android/SSH 2026](https://sealos.io/blog/claude-code-on-phone/) — overview of 3 mobile paths
- [Anthropic Remote Control docs](https://code.claude.com/docs/en/remote-control) — official feature
- [Help Net Security on Remote Control Feb 2026](https://www.helpnetsecurity.com/2026/02/25/anthropic-remote-control-claude-code-feature/)
- [DevOps.com on Remote Control architecture](https://devops.com/claude-code-remote-control-keeps-your-agent-local-and-puts-it-in-your-pocket/)
- [QuivrHQ/247-claude-code-remote on GitHub](https://github.com/QuivrHQ/247-claude-code-remote) — Tailscale + Fly.io VMs template
- [Pete Sena: iPhone + Tailscale + Termius + tmux](https://petesena.medium.com/how-to-run-claude-code-from-your-iphone-using-tailscale-termius-and-tmux-2e16d0e5f68b)
- [Titus Soporan: Remote AI Coding with Tailscale SSH](https://tsoporan.com/blog/remote-ai-development-claude-code-tailscale/)
- [Skeptrune: Termux + Tailscale Android setup](https://www.skeptrune.com/posts/claude-code-on-mobile-termux-tailscale/)
- [Rogs: Claude Code from the beach (mosh + tmux + ntfy)](https://rogs.me/2026/02/claude-code-from-the-beach-my-remote-coding-setup-with-mosh-tmux-and-ntfy/)
- [Stratega: train experiment](https://stratega.co/blog/claude-code-iphone-mobile/)
- [Weesper Neon Flow on Claude Code Voice Mode (March 2026)](https://weesperneonflow.ai/en/blog/2026-03-14-claude-code-voice-mode-developers-dictation-coding/)
- [buildmvpfast: hands-free programming guide](https://www.buildmvpfast.com/blog/claude-voice-mode-hands-free-programming)
- [Ryan Shrott: best voice dictation tools 2026](https://medium.com/@ryanshrott/best-voice-dictation-tools-for-developers-in-2026-dictaflow-vs-wispr-flow-vs-superwhisper-edc75f70de9c)
- [Wispr Flow + Claude integration](https://wisprflow.ai/use-cases/claude)
- [Apidog: 3 ways to use Claude Code on mobile](https://apidog.com/blog/claude-code-mobile/)
