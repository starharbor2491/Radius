# Radius roadmap

## M1 — Shell ✅

The browser skeleton, the token engine, and the provider layer.

- `BaseWindow` + `WebContentsView` tab engine with chrome/page z-order and
  renderer-driven insets
- Tabs, tab groups, workspaces, bookmarks, closed-tab history
- SQLite persistence, session restore, idle-tab suspension
- Design token engine: colour (OKLCH), glass, geometry, typography, motion,
  elevation → CSS custom properties at runtime
- Glass UI kit, six themes, Theme Studio with live editing and file import/export
- Command registry shared by the menu bar, keyboard and ⌘K palette
- Provider registry across all three tiers, with model discovery, cost tracking,
  and `safeStorage` key storage
- Streaming AI panel with per-tab page context

**Delivered beyond the original M1 scope:** the plan called for one working
provider (Anthropic). All three tiers shipped instead — native adapters for
Anthropic, OpenAI and Google, the OpenAI-compatible path, and manifest
providers — because dropping the AI SDK in favour of a raw fetch/SSE layer made
the generic tiers nearly free.

## M1.5 — Browser fundamentals and no-build setup ✅

- Dropped the native SQLite dependency for a zero-dependency JSON store, so
  setup is `npm install && npm run dev` with no compile step
- History with search, recency grouping and clear controls
- Downloads manager with live progress, open / reveal / cancel
- Find in page with match counts and next/previous
- Per-tab zoom on a fixed ladder
- AI quick actions: summarize, extract facts, explain, translate, simplify,
  "what is missing?" — each also a ⌘K command
- Remappable keyboard shortcuts with conflict detection
- Tab and workspace cycling

## M1.6 — Provider directory and the agent ✅

- A directory of ~30 providers with endpoints pre-filled, so adding OpenRouter,
  DeepSeek, Moonshot, DeepInfra, Databricks or a local Ollama is pick-and-paste
- Providers that cannot work with an API key alone (Bedrock's SigV4, Vertex's
  OAuth) are listed with the reason rather than silently missing
- An agent that drives the page with real mouse and keyboard input, with a
  visible labelled cursor drawn inside the page, a step cap, and a stop button

## M2 — AI depth

Done:

- Every reachable provider seeded at first launch, key-away from usable, with
  discovery firing the moment a key is saved
- Routing rules: per-feature model assignment with ordered fallback chains on
  error and rate limit, and a hard rule against switching provider once a token
  has been shown
- Budgets and alerts on the cost meter, with a usage panel and warn/block modes
- Selection actions — explain, translate, simplify
- Whole-workspace Q&A across open tabs
- Reasoning-token streaming, shown collapsed and kept out of the answer

Still open:

- Tool calling in the native adapters
- Per-site zoom and permission memory
- Agent: per-step confirmation mode, navigation actions, multi-tab tasks
- AWS SigV4 signing and Vertex OAuth, to unblock those two providers

## M3 — Customization surfaces

Done:

- Layout editor: dockable `left`/`right`/`bottom` regions, drag-and-drop panels
  with visible drop targets, per-workspace layouts that survive a restart
- Chord bindings (`g` `t`) driven by a pure matcher state machine, with
  Radius/Vim/Arc/Chrome preset sets and chord-aware conflict detection
- Theme gallery whose cards are real miniature chromes rendered by the token
  engine, `.radius-theme.json` import and export with per-field error reporting,
  and user CSS against a documented 22-name `data-radius-part` contract
- Per-workspace theme overrides across the whole document, stored as a diff so a
  workspace inherits later edits to the base
- Contrast reported at the control against the threshold that applies, never
  silently corrected
- `DESIGN.md`: the rules the chrome follows, so a component that breaks one is a
  bug rather than a matter of taste

Still open:

- Reordering panels *within* a region (the document supports it; there is no
  gesture)
- `top` and `floating` regions — see `ARCHITECTURE.md` for why both were left out
- Three-step chords: the matcher is length-agnostic but the capture UI stops at
  two

## M4 — Motion pass

Done. The catalogue, each item driven by motion tokens so it stays tunable and
disableable:

tab hover lift · tab peek preview with real page thumbnails · magnetic snap into
groups · group accordion · omnibox morph-expand from pill to panel · palette
stagger · streaming-token shimmer · assistant thinking pulse · copy-to-checkmark
morph · toast physics · rubber-band sidebar resize · workspace cross-fade with
directional parallax · spinner→favicon morph · drop-zone glow · press ripple from
the point pressed · travelling focus ring · scroll-boundary containment

Plus:

- **A motion studio**: presets (Reduced/Snappy/Balanced/Expressive), speed, the
  hover/press/ripple/rubber-band amounts, stagger, and all six springs — each
  with a preview that runs the actual transition on the actual physics, because
  nobody can tell what damping 34 feels like by reading it
- **`npm run audit:motion`**: boots the real app, drives every animation and
  samples frame deltas, judged against the machine's own idle floor
- Three new duration tokens for looping animations, kept an order of magnitude
  slower than the one-shot durations — a loop that runs at "fast" is a strobe

Still open:

- Tab peek shows the last capture, so a tab you have never left has no preview.
  Capturing on first paint would close that, at the cost of a readback per load.
- The peek is anchored inside the sidebar rather than over the page: the chrome
  sits *under* the page view, and raising it is modal. See `ARCHITECTURE.md`.

## M5 — Hardening and ship

- Split view (2–4 tiled page views with draggable dividers)
- Semantic history search over locally embedded page text (sqlite-vec)
- Memory profiling and suspension tuning at 200+ tabs
- Multi-window
- Auto-update and signed builds for macOS, Windows and Linux

## Past M5

- Chrome extension support
- Encrypted cross-device sync
- Profiles (isolated session partitions) as a first-class UI concept
