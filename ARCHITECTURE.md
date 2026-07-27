# Radius architecture

## Process model

```
main process (Node)
├── BaseWindow                             ← one per browser window
│   └── contentView
│       ├── ChromeView (WebContentsView)   ← React UI, transparent, full window
│       └── PageView[] (WebContentsView)   ← one per awake tab, inset
├── StateStore        authoritative app state, SQLite-backed
├── TabManager        tab lifecycle, suspension, session restore
├── ProviderRegistry  AI adapters, model catalogue, routing, cost
├── SecretStore       safeStorage-encrypted API keys
├── ThemeService      theme persistence and file import/export
└── PageContextService  readable-text extraction for the AI panel
```

`BrowserView` has been deprecated since Electron 30, so Radius uses
`WebContentsView` and `BaseWindow` throughout
([migration guide](https://www.electronjs.org/blog/migrate-to-webcontentsview)).

### Z-order is the trick

The chrome is a full-window `WebContentsView` sitting **underneath** the active
page view. The page is inset from the window edges, so the chrome is what you
see in the surrounding margin and the page covers the hole in the middle.

This matters because a full-window chrome layered *on top* would swallow every
mouse event destined for the page — Electron has no per-region hit testing for
views. With the page on top, it receives input normally.

When the renderer needs to paint over page content (command palette, omnibox
dropdown, context menu) it calls `chrome:setOverlay`, and main raises the chrome
above the page. That is modal by construction, which is the behaviour those
surfaces want anyway.

Geometry flows one way: the renderer measures its own layout with a
`ResizeObserver` and reports insets over `chrome:setInsets`; main is the only
side that may call `view.setBounds()`. That is why dragging the sidebar edge
really does resize the web page.

### Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  view, including the chrome.
- Web content runs in a dedicated session partition with **all** permission
  requests denied by default.
- Non-`http(s)` navigations are handed to the OS instead of loaded.
- `window.open` and `target=_blank` become Radius tabs, never popups.
- The chrome's HTML carries a strict CSP; it only ever loads its own bundle.
- Both preloads are dependency-free by design. A sandboxed preload can only
  `require` a short allowlist of built-ins, so `src/preload/chrome.ts` uses
  `import type` exclusively and hardcodes the event-name allowlist. A unit test
  asserts that list stays in sync with the IPC contract.

## The glassmorphism constraint

A `WebContentsView` is a native Chromium view, not a DOM node. **`backdrop-filter`
in the chrome cannot sample the page pixels underneath it** — they are separate
compositor layers. Radius exposes this honestly as four per-surface modes:

| Mode | What it does |
|---|---|
| `native` | macOS `vibrancy: 'under-window'`, Windows 11 `backgroundMaterial: 'acrylic'`. Real OS blur, zero cost, but it samples the desktop, not the page. |
| `overlay` | **Default.** `backdrop-filter` over the window's own translucent background. What most "glass" browser UIs actually ship. |
| `content-sampled` | Throttled `capturePage()` of the region under the surface, downscaled and blurred. Genuinely samples page content; costs GPU. |
| `solid` | No blur at all. For low-power machines, and the basis of the `carbon` preset. |

Linux has no guaranteed compositor, so it falls back to `overlay` over an opaque
window background.

## State flow

Main owns the state; the renderer mirrors it.

```
user gesture → IPC invoke → zod validation → StateStore mutation
             → SQLite write → coalesced notify → `state:changed` snapshot
             → zustand store → React
```

Every mutation round-trips through main. That costs a frame and buys a UI that
cannot drift from what the browser is actually doing.

Two deliberate M1 tradeoffs:

- **Full snapshots, not patches.** The payload is a few KB and it removes a
  whole class of desync bugs. Patching later fits behind the same interface.
- **Coalesced notifications.** A page load fires title, favicon and nav-state
  updates back to back; `StateStore.notify()` collapses them into one snapshot
  on the next microtask.

Runtime facts — `loading`, `suspended`, `canGoBack`/`canGoForward` — live in an
in-memory map, never in SQLite. After a restart every tab is suspended until
focused, which is what makes restoring 200 tabs instant.

### Persistence

One SQLite file (`radius.db`) in the user data directory, in WAL mode, migrated
by `user_version` pragma with hand-written forward migrations
(`src/main/db/migrations.ts`). No codegen step ships in the packaged app.

Tables: `workspaces`, `tab_groups`, `tabs`, `closed_tabs`, `bookmark_folders`,
`bookmarks`, `settings`, `secrets`, `providers`, `usage_records`.

### Tab ordering

`StateStore.moveTab` writes a fractional sort key and then renumbers the whole
workspace to `0..n-1` with pinned tabs first. `toIndex` means *the slot the tab
should occupy after it has been removed from its current position*, so a forward
move sorts past the occupant (`toIndex + 0.5`) and a backward move sorts in
front of it (`toIndex - 0.5`). Getting this backwards is subtle enough that
`tests/state.test.ts` pins both directions.

## AI provider layer

"Every provider" is only tractable as three tiers that converge on one
`ProviderAdapter` interface, so nothing above the registry knows which tier it
is talking to.

**Tier 1 — native adapters.** `src/main/ai/adapters/{anthropic,openai,google}.ts`.
Hand-written against a specific API, with correct streaming and usage parsing.

**Tier 2 — any OpenAI-compatible endpoint.** The same OpenAI adapter, pointed at
a user-supplied base URL. One code path covers Ollama, LM Studio, vLLM,
llama.cpp, Together, Groq, OpenRouter and most of the long tail.

**Tier 3 — declarative manifests.** A JSON document naming the endpoint, auth
style, which body fields carry the model and messages, the stream format, and a
dotted path to the text delta. Interpreted at runtime by
`src/main/ai/adapters/manifest.ts`. It is *data*, validated by zod — consistent
with Radius not executing third-party code.

There is no bundled AI SDK. The three tiers all reduce to "POST JSON, read a
stream of lines", and owning that path (`src/main/ai/stream.ts`, ~120 lines) is
what makes the manifest tier possible at all.

**Model catalogues come from discovery, not from source.** Published model ids
churn constantly, so the OpenAI and Google adapters ship no default list and
call `/v1/models` and `/v1beta/models` instead. A stale hardcoded list is worse
than an empty one.

**Cost** is computed from published pricing when it is known and reported as
zero when it is not. The meter never invents a figure.

**Keys** are encrypted with `safeStorage` and stored as ciphertext. All provider
HTTP happens in main. The renderer learns only that a provider `hasKey`, never
what the key is. On a Linux box with no keychain, `SecretStore` refuses to store
anything rather than implying a guarantee it cannot keep.

### Page context

When a tab is in the AI's context, `PageContextService` asks that tab's
isolated-world preload for readable text. It does **not** use
`executeJavaScript`: that runs in the page's own world, where hostile script can
shadow `document.body` or `innerText` and feed back whatever it likes.

## The token engine

`src/shared/theme.ts` defines one zod schema covering colour, glass, geometry,
typography, motion and elevation. It resolves to a flat map of `--rx-*` custom
properties that `ThemeProvider` writes onto `:root`.

Two properties make it work:

1. **Every leaf carries a default**, so a user's `.radius-theme.json` can
   contain three lines and still parse into a complete theme. (Nested objects
   use zod 4's `.prefault()` rather than `.default()`, so inner defaults still
   apply to a partial document.)
2. **No stylesheet contains a literal value.** `src/renderer/styles/app.css`
   reads only `--rx-*`. That constraint is what lets the entire chrome retheme
   without a rebuild or a reload.

Motion is part of this, not adjacent to it. Every micro-interaction pulls its
physics from a named token through `useMotionTokens()`, which is why "tune the
tab-drag spring" is a slider rather than a code change, and why disabling motion
actually disables it instead of merely shortening it.

Colours are OKLCH strings. `src/shared/color.ts` implements OKLCH → linear sRGB
and WCAG contrast so the Theme Studio can warn about a failing pair — a browser's
computed style cannot answer that question for a colour you have not applied yet.

## Deliberate non-goals for M1

- **No plugin API.** Customization is declarative data. This was an explicit
  product decision, not a scheduling one.
- **No Chrome extensions.** Electron's `chrome.*` surface is partial and this is
  a large scope of its own; it sits past M5.
- **One window.** Nothing in `WindowManager`/`TabManager` assumes it, but
  multi-window is not wired up yet.
