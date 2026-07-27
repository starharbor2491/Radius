# Radius

An AI-native, endlessly customizable productivity browser.

Radius is a desktop browser built on Electron where the assistant is a first-class
surface rather than a bolted-on sidebar, every AI provider is reachable, and
essentially every visual and motion decision is a token you can change at
runtime — no rebuild, no reload.

**Status: Milestone 1.** The shell, tab engine, token engine and provider layer
are implemented. See [ROADMAP.md](ROADMAP.md) for what is done and what is next.

## What is here

- **A real browser.** `BaseWindow` plus one `WebContentsView` per tab, with tab
  groups, workspaces, bookmarks, session restore and idle-tab suspension.
- **Every provider, in three tiers.** Hand-written adapters for Anthropic,
  OpenAI and Google; a generic OpenAI-compatible adapter covering Ollama,
  LM Studio, vLLM and most hosted vendors; and JSON *provider manifests* for
  APIs that fit no standard shape.
  See [ARCHITECTURE.md](ARCHITECTURE.md#ai-provider-layer).
- **A token engine.** One JSON document describes every colour, blur, radius,
  duration and spring in the app, resolving to CSS custom properties at runtime.
  Drag a slider in the Theme Studio and the whole chrome repaints.
- **Local-first, BYOK.** All state lives in one SQLite file in your user data
  directory. API keys are encrypted with the OS keychain through Electron's
  `safeStorage` and never cross an IPC boundary. There is no server component.

## Getting started

```bash
npm install
npm run rebuild     # build better-sqlite3 against Electron's ABI
npm run dev
```

`npm run rebuild` is required once after install, and again after any Electron
upgrade: `better-sqlite3` is a native module and ships prebuilds for Node, not
for Electron. It needs a working toolchain (python3, make, a C++ compiler) and
network access to `electronjs.org` for the matching headers.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run in development, with HMR for the chrome |
| `npm run build` | Typecheck, then build main, preload and renderer |
| `npm test` | Unit tests (vitest) |
| `npm run smoke` | Boot the built chrome in Electron and assert it renders |
| `npm run typecheck` | Typecheck the Node and web projects |
| `npm run rebuild` | Rebuild native modules against Electron |
| `npm run package` | Build and package with electron-builder |

## Configuring a provider

Open Settings (⚙ in the toolbar), paste an API key, and press **Discover
models** — Radius asks the provider what your key can actually reach rather
than relying on a hardcoded list that goes stale.

For a local model, use **Add a provider** with an OpenAI-compatible base URL
(`http://localhost:11434/v1` for Ollama). For anything stranger, the JSON
manifest form describes the endpoint, the auth style, and where the text lives
in the response. A manifest is interpreted as data, so adding a provider never
means running third-party code.

## Customizing

Everything below is declarative data, validated on load and exportable as a file:

- **Theme Studio** (⌘⇧,) — colour in OKLCH with live WCAG contrast checking,
  per-surface glass (blur, saturation, tint, grain, edge light), geometry, the
  type scale, motion springs, and user CSS.
- **Themes** are `.radius-theme.json`. Every field is optional, so a theme file
  can be three lines long; anything unspecified falls back to the defaults.
- **Motion is tokenized.** The tab-drag spring's stiffness and damping are
  sliders, not constants. Turning animations off actually turns them off, and
  `prefers-reduced-motion` is honoured unless you explicitly override it.

Radius does not execute third-party JavaScript for customization. That is a
deliberate limit: themes stay data, which keeps the risk of "install a theme
someone sent you" close to zero.

## Keyboard

| Shortcut | Action |
|---|---|
| ⌘T / ⌘W / ⌘⇧T | New tab / close tab / reopen closed tab |
| ⌘L | Focus the address bar |
| ⌘K | Command palette |
| ⌘J | Toggle the AI panel |
| ⌘B | Toggle the sidebar |
| ⌘⇧N | New workspace |
| ⌘⇧, | Theme Studio |

Every command is remappable-by-design: the menu bar, the keyboard and the
palette all dispatch through one registry in `src/renderer/lib/commands.ts`.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).
