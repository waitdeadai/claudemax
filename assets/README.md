# claudemax brand assets

Apache-2.0 (same as the project). Use freely; attribution appreciated.

## Files

| File | Use |
|---|---|
| `claudemax.png` | **The official claudemax mascot — README hero.** Pixel-art electric-cyan creature with two eyes and 8-directional spike protrusions. Transparent background. Used at the top of `README.md` (centered, 200px). Also the project icon / favicon / avatar. |
| `og-image.png` | **GitHub social-preview / Open Graph card.** 1774 × 887 (2:1), mascot + `claudemax` wordmark + tagline on deep-ink background. Upload via GitHub Settings → General → Social preview so it renders on Twitter/X/Slack/Discord/LinkedIn link previews. Independent from the README hero — both can coexist. |
| `README.md` | This file — palette + usage notes. |

## Mascot

Pixel-art electric-cyan creature on transparent background. Geometric "hashtag-meets-cogwheel-meets-pixel-creature" silhouette with two vertical black eye slits and 8-directional rectangular protrusions reading as spokes / spikes / pixel-shaped tentacles. The 8-bit retro-arcade aesthetic signals power-user terminal tooling rather than enterprise polish.

Why this works for claudemax:

- The 8 outer protrusions mirror the harness's max-parallel principle (default hardware caps of 3 / 6 / 10 agents; 8 satellite spokes around a central node read as "many independent workers around an orchestrator").
- Electric cyan on transparent reads the same on dark or light backgrounds — works in terminal output, on GitHub light/dark mode, and on social cards.
- Pixel-art rejects the enterprise-AI-mascot visual idiom (smooth gradients, friendly faces, hand-drawn warmth) — this is a power tool, not a chatbot.

## Color palette

| Role | Hex | Notes |
|---|---|---|
| Electric cyan (primary) | `#00E5FF` (approx) | Mascot body |
| Pure black (eyes / accent) | `#000000` | Eye slits |
| Off-white (foreground on dark UI) | `#E0FBFF` | README copy on dark themes |
| Cyan deep (accent for headings/links) | `#00B8D4` | Hover states, links |

## Usage examples

In markdown (project README hero):

```markdown
<p align="center">
  <img src="./assets/claudemax.png" alt="claudemax mascot" width="200">
</p>
```

As GitHub social card (Open Graph):

```html
<meta property="og:image" content="https://raw.githubusercontent.com/waitdeadai/claudemax/main/assets/og-image.png" />
```

For GitHub's repo-level social preview (the actual image rendered when the repo URL is shared on Twitter/X, Slack, Discord, LinkedIn), upload `assets/og-image.png` manually via **Settings → General → Social preview**. The `<meta>` tag above is only honored on third-party pages that reference `raw.githubusercontent.com` directly.

As favicon:

```html
<link rel="icon" type="image/png" href="./assets/claudemax.png">
```

## Non-infringement notes

- No use of Anthropic's coral/orange palette (deliberately electric cyan on transparent).
- Pixel-art aesthetic is its own visual idiom (8-bit gaming heritage), not derivative of Claude's brand.
- No anthropomorphic / face-with-emotions forms (Claude's brand often uses warm friendly faces).
- No "C" letterform mimicking Anthropic's stylized C.
- Color `#00E5FF` is Material Design Cyan A400 — public color.

## Producing additional sizes

To generate a square avatar / favicon from the source (requires ImageMagick — `apt install imagemagick` / `brew install imagemagick`):

```bash
convert assets/claudemax.png -resize 256x256 assets/favicon-256.png
convert assets/claudemax.png -resize 64x64 assets/favicon-64.png
convert assets/claudemax.png -resize 32x32 assets/favicon-32.png
```
