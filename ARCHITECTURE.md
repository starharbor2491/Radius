# Radius architecture

## Process model

```
main process (Node)
├── BaseWindow                             ← one per browser window
│   └── contentView
│       ├── ChromeView (WebContentsView)   ← React UI, transparent, full window
│       └── PageView[] (WebContentsView)   ← one per awake tab, inset
├── StateStore        authoritative app state, JSON-backed
├── TabManager        tab lifecycle, suspension, session restore
├── ProviderRegistry  AI adapters, model catalogue, routing, cost
├── SecretStore       safeStorage-encrypted API keys
├── ThemeService      theme persistence and file import/export
├── DownloadService   tracks transfers started by page content
├── AgentController   synthetic mouse/keyboard, visible cursor, element map
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

### Room for the window's own buttons

macOS draws close/minimise/zoom over the top-left of a frameless window, and
the chrome has to keep out from under them. The three buttons are 14pt across
on 20pt centres, so the group spans about 54pt and reaches roughly 68px from
the window edge with the inset `hiddenInset` gives it. The workspace rail is
52px, so the zoom button was landing on the workspace name -- and on the
toolbar's first button whenever the sidebar was closed.

The reservation is two tokens (`--rx-window-controls-width/height`) set from
`.rx-shell[data-platform='mac']` and zero everywhere else, so nothing moves on
Windows or Linux. The overspill past the rail is taken as left padding by
whatever is immediately to its right: the sidebar's header row, or the toolbar
when the sidebar is closed. Both stay on the line they were already on rather
than the whole column shifting down.

Driving it off a data attribute rather than a media query is what makes it
testable from any platform: `npm run smoke:app` forces the attribute, then
looks for anything clickable in that corner. Worth asserting rather than
eyeballing, since the machine CI runs on is not a Mac and the failure is
invisible there.

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
             → JSON write → coalesced notify → `state:changed` snapshot
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
in-memory map, never on disk. After a restart every tab is suspended until
focused, which is what makes restoring 200 tabs instant.

### Persistence

One JSON document (`radius-state.json`) in the user data directory, held in
memory and written atomically — temp file plus rename, so a crash mid-write
leaves the previous document intact rather than a truncated one. Writes are
debounced ~300ms because a single page load mutates state several times; secrets
flush immediately.

Collections: `workspaces`, `groups`, `tabs`, `closedTabs`, `bookmarkFolders`,
`bookmarks`, `history`, `downloads`, `providers`, `usage`, `secrets`, `settings`.

**This replaced SQLite deliberately.** `better-sqlite3` is a native module, so
every install needed a C++ toolchain and an `electron-rebuild` pass against
Electron's ABI — by far the most fragile step in getting the app running, and
unnecessary at this data scale. A browser's own state is a few hundred KB; a
JSON document in memory beats a query planner for it, and setup collapses to
`npm install && npm run dev`.

The limit is real and bounded: this does not scale to the full-text and vector
search that semantic history wants in M5. That feature can bring its own index
without disturbing anything here.

An unreadable document is moved aside and the app starts empty, because a
browser that refuses to open because its state file is malformed is worse than
one that opens fresh.

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

**Every reachable provider is seeded at first launch.** `seedBuiltIns` walks
`seedableCatalogEntries()` rather than the three native adapters, so OpenAI,
Gemini, Grok, DeepSeek, OpenRouter, Fireworks, DeepInfra, Cerebras and the rest
are on the list from the start, each one a pasted key away from working.

The two rules above collide in a way worth stating: a seeded provider has no
models until discovery runs, and discovery needs a key. Earlier builds resolved
that by hiding model-less providers from the pickers, which meant a browser
shipping thirty providers offered exactly one — Anthropic, the only adapter with
a default list. Now `setKey` kicks off discovery itself, and `ModelPicker`
degrades to a typed model id plus a Discover button rather than hiding the
provider. Removing a seeded provider records it under `aiDismissedProviders`, or
the next boot would seed it straight back.

**Transcripts are normalised before any adapter sees them.** Most of the
Mistral and Llama families -- and anything served through a Jinja chat template,
which is everything LM Studio and Ollama run -- do not merely prefer
alternating roles, they raise on anything else:

> Jinja Exception: After the optional system message, conversation roles must
> alternate user and assistant roles

That arrives as a 500 with no indication of which message was at fault, so it is
worth never sending one. Radius produced them routinely: the agent loop sent the
result of an action and then the new page map as two separate user turns, and
the chat panel leaves a user turn with no reply behind when a request fails, so
the next question is a second user turn in a row.

`normaliseForChatTemplate` merges consecutive same-role turns, folds every
system message into one at the front, and drops empty ones. It runs in
`ProviderRegistry.attempt`, at the last point before an adapter is called, so
every caller and every tier is covered at once -- which matters most for the
OpenAI-compatible tier, where the endpoint is whatever the user configured and
its strictness is unknowable from here.

**Cost** is computed from published pricing when it is known and reported as
zero when it is not. The meter never invents a figure.

**Keys** are encrypted with `safeStorage` and stored as ciphertext. All provider
HTTP happens in main. The renderer learns only that a provider `hasKey`, never
what the key is. On a Linux box with no keychain, `SecretStore` refuses to store
anything rather than implying a guarantee it cannot keep.

### Routing and budgets

`src/shared/routing.ts` holds two pure ideas that `ProviderRegistry.run` walks:
*which* provider+model pairs a feature should try, in order, and *whether* a
given failure is worth trying the next one for.

Failing over is deliberately narrow. A rate limit (429), a server fault (5xx), a
request timeout or a dead socket means the provider could not answer *this
time*, so the next candidate gets a turn. A 401, 403 or 400 means the request
itself was refused — a missing key, a malformed body, a model id that does not
exist — and handing the same request to the next provider would spend its quota
to produce the same error with the original hidden behind it. Anything
unrecognised does not fail over: a chain is a resilience feature, not a reason
to fan an unknown fault across every provider a user owns.

The hard rule is that **a run never fails over once a token has been emitted**.
A half-written answer must not get a second author; the user would read one
paragraph from one model continued by another with no seam to see. A fallback
that does happen is announced as a `notice` stream event, because the answer
came from somewhere other than what the dropdown says.

`src/shared/budget.ts` evaluates recorded usage against a monthly limit and
returns `ok` / `warn` / `over`; `over` plus the `block` action stops a run
before the provider is called. Because `estimateCost` reports zero for a model
with no published pricing, this is a bound on *tracked* spend, and every surface
that shows it says so — the usage panel names how many runs were unpriced rather
than letting the total imply completeness.

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

### Themes compose; they do not overwrite

Three documents stack, most specific last:

```
global theme            settings.theme, one complete document
  └── workspace.themeId        a preset the workspace pins as its base instead
        └── workspace.themeOverride   a partial document, any subset of tokens
```

`workspace.accent` is deliberately *not* in that chain, though it used to be. It
is the workspace's identity colour in the rail, assigned at creation from a
rotating palette — nobody chose it. While it masked the theme's accent, applying
a theme never changed the accent, which made a gallery of previews lie about
what its presets look like. A workspace that wants a different accent overrides
`colors.accent` like any other token; the studio writes the chip colour to match
when it does.

Merging happens on the **document**, not on resolved CSS variables, and the
result goes back through `ThemeSchema`. That is what makes an override safe to
store loosely: a workspace can name a token this build has never heard of, or a
value out of range, and the merge reports it (`resolveThemeOverride` returns the
issues) instead of painting something wrong. A broken override leaves the base
theme visible rather than a broken window.

A workspace stores the *difference* from its base, never a copy of it —
`themeOverrideDiff` is applied on every write. A workspace that wanted a denser
layout carries two tokens and inherits every later edit to the other ninety.

### A theme file is a partial document

`.radius-theme.json` round-trips through the same schema in both directions.
Export writes the resolved document because it is meant to be readable; import
accepts anything from that down to two tokens, which is what `.prefault({})` on
every nested object buys.

Import returns a *report*, not a theme-or-null. "Invalid theme" is useless to
someone hand-editing JSON, so `parseThemeDocument` keeps zod's path and the
studio prints `glass.chrome.blur — Too big: expected number to be <=200`. A file
that parses reports how many tokens it actually named, so a three-line theme
says three rather than implying it set the ninety it resolved to.

Both directions live in main (`ThemeService`): file dialogs are a main-process
capability. Import deliberately does not apply what it read — the renderer holds
the "what was in use before" that the gallery's revert needs, so importing is a
read and applying is the same `theme:set` any other edit takes.

### The gallery previews with the real engine

`resolveThemeVars` is pure and returns nothing but custom properties, so setting
its output on an element instead of on `:root` renders a second complete theme
inside the first. A gallery card is not a picture of a theme; it is the same
token engine scoped to a box, which is why a dense preset previews dense and one
with no blur previews flat.

Hovering a card applies it to the whole window anyway, because a 150px
miniature cannot tell you whether a theme is comfortable to read a tab strip in.
Nothing persists until the card is clicked, and the header keeps a way back to
what was in use when the gallery opened — a live preview is only honest if
leaving it is free.

### User CSS, and the `data-radius-part` contract

User CSS is the one place a person hands Radius something free-form. It is CSS,
it is injected into the **chrome view only** — never into a page view — and it
is never evaluated as script. It is applied by assigning `textContent` on one
`<style>` element, so it cannot introduce markup, and `sanitizeUserCss` strips
`@import` and remote `url()` (a theme is a local document; picking a colour
should not make a network request) along with the legacy script-in-CSS vectors.
Everything stripped is reported at the editor rather than dropped silently, and
the document keeps what the user typed so they can fix it.

What that CSS aims at is a stable name. Class names are not one — `rx-tab` is an
implementation detail of the stylesheet and a refactor may rename it. These
attributes are the promise instead, listed in `src/renderer/theme/parts.ts` and
pinned by `tests/theme-parts.test.ts`, which fails if one is documented but not
rendered:

| `data-radius-part` | What it marks |
|---|---|
| `shell` | The chrome's root element |
| `sidebar` | The whole left sidebar |
| `workspace-rail` | The icon rail inside the sidebar |
| `workspace-chip` | One workspace button in the rail |
| `tab-strip` | The scrolling list of tabs |
| `tab` | One tab row |
| `toolbar` | The top bar holding navigation and the omnibox |
| `omnibox` | The address field and its display state |
| `find-bar` | Find in page |
| `panel` | The body of a docked panel |
| `panel-header` | That panel's title row |
| `panel-title` | The title text itself |
| `command-palette` | The command palette surface |
| `button` | Every text button |
| `icon-button` | Every icon-only button |
| `field` | A labelled control |
| `field-label` | That control's label |
| `slider` | Every range input bound to a token |
| `toast` | The transient message |
| `glass` | Any glass surface (pair with `data-surface`) |
| `theme-gallery` | The gallery section |
| `theme-card` | One preset card |

Adding a part is additive and cheap. Removing or renaming one breaks every theme
a user has written, so it takes the same care as changing an IPC channel.

### Contrast is reported, never corrected

`auditThemeContrast` grades the six pairs the chrome actually renders — body
text on a panel and on the window backdrop, muted and faint text, a label on an
accent button, and the accent against a panel — each against the WCAG threshold
that applies to it (4.5:1 for text, 3:1 for hint text and for non-text UI under
1.4.11).

A failing pair is named at the control that causes it, with the measured ratio
and the rule it missed. Nothing is silently nudged into range: a user who wants
a low-contrast theme gets one and is told what it costs. Gallery cards carry the
same badge, and no shipped preset fails its own check — a test asserts that.

## Motion

Every animation pulls its physics from `useMotionTokens()`. No component writes
a duration, a spring or a distance — those are tokens, which is what makes "tune
the tab-drag spring" a slider rather than a code change.

Three rules the pass established, each of which came from something that went
wrong:

**Turning motion off has to mean nothing moves.** Not "moves instantly". A tween
collapsing to `{ duration: 0 }` is correct for a one-shot, and a *busy loop* for
a repeating one — a zero-length animation repeating forever pins a core. `loop()`
returns null instead and the caller renders the resting state. The same applies
to distances: `hoverLift`, `pressScale`, `ripple`, `rubberBand` and `stagger` all
resolve to zero, so nothing is displaced instantly either. `--rx-stagger` used to
keep its full value with motion disabled, which meant a twelve-row list still
took a third of a second to finish appearing with no animation on any row.

**Do not animate children inside an animating container.** The workspace switch
slides the whole strip; animating its twelve rows *as well* cost 183ms worst
frame to show something invisible underneath a moving parent. Same for the
command palette, which listed forty commands each with an entrance while the
palette itself was scaling. Both now stand their children down.

**Measure, do not assert.** `npm run audit:motion` boots the real app, loads it
with tabs and groups, drives each animation and samples `requestAnimationFrame`
deltas. It reports the worst frame and the share over budget, because a mean of
60fps with one 200ms stall is a janky UI that averages fine.

Two things that audit taught us are worth keeping in mind when reading its
output:

- **Absolute frame times are meaningless without a GPU.** In a headless session
  everything composites in software, and every number lands on an exact multiple
  of the vsync interval. The audit measures the machine's own idle floor first
  and judges against that.
- **The glass is the expensive thing, not the motion.** Flattening
  `backdrop-filter` to zero drops the worst frame more than disabling every
  animation does. That is why the `carbon` and `terminal` presets exist and why
  `solid` is a first-class glass mode rather than a degraded one — on a machine
  without GPU compositing it is the difference between a smooth chrome and a
  slow one.

## The layout system

The chrome is not a fixed frame. `src/shared/layout.ts` holds a zod-validated
document naming three regions — `left`, `right`, `bottom` — each with an ordered
panel list, which panel is active, and a size. Panels are dragged between
regions by their title bar, and the arrangement is stored **per workspace**, so
a research workspace and a writing workspace can be shaped differently.

The default document puts all seven panels in `right` with none active, which
reproduces the previously hardcoded chrome exactly. A workspace persisted before
the layout editor existed parses through `parseLayout` rather than arriving as
`undefined`.

Two constraints deserve stating, because both are consequences of the z-order:

- **Every region has to be measured.** Main places the page view from insets the
  renderer reports; a region main does not know about is a region the page view
  covers. `reportInsets` measures the bottom dock's height and the left dock's
  width alongside the sidebar, and effects key on `layoutSignature` so a favicon
  landing does not restart inset polling.
- **Dragging enters overlay mode.** The left and bottom drop targets sit over
  ground the page view owns, so without raising the chrome the user would be
  dragging toward an invisible target.

`top` and `floating` are deliberately absent. The toolbar is not a panel — it is
the window's own furniture, and a floating region needs a window manager's worth
of behaviour (focus, stacking, off-screen recovery) to not be a trap.

Reordering panels *within* a region is supported by the document and the pure
functions but has no gesture yet; only whole-region drops are wired.

## The agent

The assistant can drive a page. Three decisions make it work:

**Real input events, not synthetic clicks.** `webContents.sendInputEvent`
rather than calling `element.click()` from the preload. Synthetic DOM clicks
are untrusted events that plenty of sites ignore, and they cannot type into a
React-controlled input convincingly. Real events behave exactly like a person's.

**The cursor is drawn inside the page.** The page is a native view stacked
above the chrome, so anything the chrome painted would be hidden behind it. The
page preload owns a `pointer-events: none` overlay in a closed shadow root, so
page CSS cannot restyle it and it never intercepts a click meant for the page.

**JSON actions, not provider tool-calls.** Tool-calling APIs differ per vendor
and are missing from many OpenAI-compatible endpoints. Asking any model for one
JSON object per step is what makes the agent work on *every* provider rather
than the three with the richest API. `parseAgentAction` digs the object out of
prose and code fences, because models add commentary regardless of instructions.

The safety properties are structural rather than advisory: the cursor is always
visible while acting, it glides rather than teleports, only viewport-visible
elements are offered to the model, runs are capped at `MAX_AGENT_STEPS`, Stop
cancels mid-action, and the system prompt refuses credentials and checkout.

## Find in page

`webContents.findInPage` has a genuine trap: `findNext: true` means *begin a new
find session* and `false` means *advance within the current one* — the reverse
of what the name suggests. Sending `false` with no session open reports nothing
at all, silently. A new or edited query therefore sends `true`; the next/previous
buttons send `false`. This is noted at the IPC contract and at the call site
because it costs an hour to rediscover.

The find bar lives inside the chrome strip rather than as an overlay, so the
page stays scrollable and interactive while you search it — overlay mode would
make the whole page inert.

## Deliberate non-goals for M1

- **No plugin API.** Customization is declarative data. This was an explicit
  product decision, not a scheduling one.
- **No Chrome extensions.** Electron's `chrome.*` surface is partial and this is
  a large scope of its own; it sits past M5.
- **One window.** Nothing in `RadiusWindow`/`TabManager` assumes it, but
  multi-window is not wired up yet.
- **Zoom is per tab, not per site.** It lives in the runtime map, so it resets
  when a tab is suspended. Per-origin persistence is a later change.
