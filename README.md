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
- **Every provider, from a list.** A built-in directory of ~30 providers —
  OpenRouter, DeepSeek, Moonshot, DeepInfra, Groq, Together, Fireworks,
  Cerebras, Databricks, Azure, Ollama and the rest — each with its endpoint
  already filled in. Pick a name, paste a key. Anything not listed works too,
  via an OpenAI-compatible base URL or a JSON manifest.
  See [ARCHITECTURE.md](ARCHITECTURE.md#ai-provider-layer).
- **An assistant that can use the browser.** Give it a task and it drives the
  page with a real mouse and keyboard — and its cursor is drawn *on the page*,
  labelled, so you can watch every move and stop it at any point.
- **A token engine.** One JSON document describes every colour, blur, radius,
  duration and spring in the app, resolving to CSS custom properties at runtime.
  Drag a slider in the Theme Studio and the whole chrome repaints.
- **The rest of a browser.** History with search, a downloads manager, find in
  page, per-tab zoom, and a command palette that reaches all of it.
- **Local-first, BYOK.** All state lives in one JSON file in your user data
  directory. API keys are encrypted with the OS keychain through Electron's
  `safeStorage` and never cross an IPC boundary. There is no server component.

## Install on macOS

Paste this into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/starharbor2491/Radius/claude/ai-productivity-browser-plan-fuijdl/scripts/install-mac.sh | bash
```

Once this branch is merged, the shorter form works instead:

```bash
curl -fsSL https://raw.githubusercontent.com/starharbor2491/Radius/main/scripts/install-mac.sh | bash
```

It installs `Radius.app` into your Applications folder and opens it. If a build
has been published for your Mac it downloads that; otherwise it builds from
source, which takes a few minutes and needs nothing installed beforehand — even
Node is fetched to a temporary folder and thrown away afterwards.

Requires macOS 12 or newer. It only asks for your password if your Applications
folder is not writable by your account.

Radius is **not signed with a paid Apple Developer identity**, so it is ad-hoc
signed instead. The installer clears the quarantine flag so it opens normally;
if macOS still objects, right-click the app in Applications and choose Open.

To uninstall: drag Radius out of Applications, and delete
`~/Library/Application Support/Radius` to remove your data.

## Running from source

```bash
npm install
npm run dev
```

That is the whole setup. Radius has no native modules, so there is no compile
step, no build toolchain to install, and nothing to rebuild when Electron
updates -- `npm install` downloads packages and `npm run dev` opens the browser.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run in development, with HMR for the chrome |
| `npm run build` | Typecheck, then build main, preload and renderer |
| `npm test` | Unit tests (vitest) |
| `npm run smoke` | Boot the chrome in Electron and assert it renders |
| `npm run smoke:app` | Boot the whole app, navigate to a page, assert it works |
| `npm run typecheck` | Typecheck the Node and web projects |
| `npm run package:mac` | Build a macOS `.app`, `.dmg` and `.zip` |
| `npm run package` | Build and package for the current platform |

## Letting the assistant drive

Open the agent panel (⌘⇧A), describe what you want done on the current page,
and press Start. It reads what is on screen, moves a visible cursor, clicks and
types like a person would, and reports each step.

It is bounded on purpose: the cursor is always visible while it works, it moves
in followable steps rather than teleporting, runs are capped, Stop cancels
mid-action, and it is instructed to refuse credentials, payment details and
checkout flows.

## AI quick actions

The assistant panel (⌘J) carries one-tap actions over whatever you are reading:
summarize, extract key facts, explain the selection, translate, simplify, and
"what is missing?". Each runs through the same provider and streaming path as
ordinary chat, and each is also a ⌘K command.

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
| ⌘F | Find in page |
| ⌘Y | History |
| ⌘⇧J | Downloads |
| ⌘+ / ⌘- / ⌘0 | Zoom in, out, reset |
| ⌘⇧A | Let the assistant drive the page |
| ⌘⇧, | Theme Studio |

Every one of these is remappable in Settings — press the key you want and it is
saved. The menu bar, the keyboard and the palette all dispatch through one
registry in `src/renderer/lib/commands.ts`, so a command is defined once.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).
