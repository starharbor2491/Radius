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

## M2 — AI depth

- Routing rules: per-feature model assignment with ordered fallback chains on
  error and rate limit
- Selection actions — explain, translate, rewrite, extract to note
- Whole-workspace Q&A across open tabs
- Tool calling and reasoning-token handling in the native adapters
- Budgets and alerts on the cost meter
- Per-site zoom and permission memory
- Bounded page agent (fill, click, navigate) with per-step confirmation

## M3 — Customization surfaces

- Layout editor: dockable regions (`top`/`bottom`/`left`/`right`/`floating`),
  drag-and-drop panels, per-workspace layout presets
- Chord bindings (`g` `t`) and Radius/Vim/Arc/Chrome preset sets on top of the
  existing remapper
- Theme gallery and a documented `data-radius-part` contract for user CSS
- Per-workspace theme overrides beyond the accent

## M4 — Motion pass

The full micro-interaction catalogue, each driven by motion tokens so it stays
tunable and disableable:

tab hover lift and peek preview · magnetic snap into groups · group accordion ·
omnibox morph-expand · palette stagger · streaming-token shimmer · AI thinking
pulse · copy-to-checkmark morph · toast stack physics · rubber-band sidebar
resize · workspace cross-fade and parallax · spinner→favicon morph · drop-zone
glow · press ripple · travelling focus ring · scroll-boundary bounce

Plus a 60fps audit and a motion-token tuning UI.

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
