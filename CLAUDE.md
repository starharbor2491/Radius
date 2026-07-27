# Working on Radius

Radius is an AI-native desktop browser: Electron + React, with a token engine
that makes every visual and motion decision changeable at runtime, and an AI
layer that reaches any provider.

Read `ARCHITECTURE.md` before changing anything structural. It explains *why*
the odd-looking decisions are the way they are, and most of them are load
bearing.

## Commands

```bash
npm install          # no native modules; this is the whole setup
npm run dev          # run with HMR for the chrome
npm test             # vitest, ~170 tests, ~2s
npm run typecheck    # three TS projects: node, web, test
npm run build        # typecheck + build all three bundles
npm run smoke        # boot the chrome with a stubbed bridge (fast)
npm run smoke:app    # boot the real app, navigate, drive the agent (thorough)
```

`npm run smoke:app` is the one that catches real bugs. It boots the actual main
bundle, serves a local page, navigates to it, and asserts history recording,
text extraction, find-in-page, zoom and agent input all work through real IPC.
Three bugs have been found by it that no amount of reading would have caught.

In a headless environment, prefix with `xvfb-run -a` and pass `--no-sandbox`.

## Layout

```
src/shared/     types, IPC contract, theme tokens, provider catalogue, agent protocol
src/main/       Electron main: window, tabs, storage, AI, agent, downloads
src/preload/    two dependency-free bridges (chrome + page)
src/renderer/   React chrome
tests/          vitest, pure logic only (no Electron)
scripts/        the two smoke tests
```

## The five things that will bite you

**1. Z-order is why the browser works.** The chrome is a full-window
`WebContentsView` sitting *underneath* an inset page view. Put the chrome on
top and it swallows every click meant for the page — Electron has no per-region
hit testing. Overlay mode (`chrome:setOverlay`) raises the chrome only while a
palette or dropdown is open, and is modal by construction.

**2. `backdrop-filter` cannot see page pixels.** The page is a separate native
compositor layer. Glass has four honest modes rather than one broken one; see
the table in `ARCHITECTURE.md`.

**3. Electron's `findNext` reads backwards.** `true` means *begin a new find
session*; `false` means *advance within the current one*. Sending `false` with
no session open reports nothing, silently. New query → `true`. Next/previous →
`false`.

**4. zustand v5 compares snapshots by identity.** A selector that filters or
sorts returns a new array every call and will spin React into "maximum update
depth exceeded". Select a stable slice (`state.tabs`) and derive with `useMemo`
outside. `useWorkspaceTabs` is the pattern to copy.

**5. zod 4 `.default()` on an object short-circuits parsing.** Nested token
objects use `.prefault({})` so a partial theme document still gets its inner
defaults. Get this wrong and a three-line `.radius-theme.json` fails to parse.

## Conventions

**No literal values in the stylesheet.** `src/renderer/styles/app.css` reads
only `--rx-*` custom properties. That single constraint is what lets the whole
chrome retheme with no rebuild and no reload. If you need a new colour or
duration, add a token in `src/shared/theme.ts` — do not inline it.

**Motion comes from tokens.** Every animation pulls its physics through
`useMotionTokens()`. Never write a hardcoded spring or duration in a component;
that would make it untunable and un-disableable.

**The IPC contract is the boundary.** Add a channel to `src/shared/ipc.ts` with
zod request/response schemas, then a handler in `src/main/ipc/handlers.ts`. The
`HandlerMap` type means TypeScript fails the build if you add a channel and
forget the handler. Payloads are validated in main before any handler sees them.

**Preloads import nothing at runtime.** A sandboxed preload can only `require`
a short allowlist of built-ins, so `src/preload/chrome.ts` uses `import type`
exclusively and hardcodes the event-name allowlist. A test asserts that list
stays in sync with `ipcEvents` — if you add an event, update both.

**Main owns state; the renderer mirrors it.** Every mutation round-trips
through main and comes back as a full snapshot. Do not mutate the zustand store
locally to "make it feel faster" — that reintroduces exactly the desync this
design removes.

**Secrets never cross IPC.** The renderer can set a key and learn that a
provider `hasKey`. It can never read one. All provider HTTP happens in main.

**Say what is not known.** Model pricing defaults to `null`, not a guess, and
the cost meter shows nothing rather than a fabricated number. Model catalogues
come from runtime discovery, not hardcoded lists that go stale.

## Adding things

**A provider:** if it speaks the OpenAI chat-completions shape, add an entry to
`src/shared/provider-catalog.ts` — that is the whole change. Only write an
adapter in `src/main/ai/adapters/` when the API shape is genuinely different
(as Anthropic's and Google's are). If it needs request signing or OAuth, mark it
`blocked` with a reason rather than half-supporting it.

**An agent capability:** extend `AgentActionSchema` in `src/shared/agent.ts`,
handle it in `AgentController.perform`, and document it in
`AGENT_SYSTEM_PROMPT`. The action vocabulary is JSON rather than provider
tool-calls on purpose: tool-calling APIs differ per vendor and are missing from
many OpenAI-compatible endpoints, and the agent has to work on all of them.

**A theme token:** add it to the schema with a default, emit it in
`resolveThemeVars`, and consume it in the stylesheet. Every leaf needs a
default or partial theme files break.

## The agent's safety properties

These are deliberate. Do not weaken them without saying so plainly:

- The cursor is **always visible** while the agent is acting. That is the
  feature and the safeguard — the user can see what it touches.
- The cursor **glides** rather than teleporting, so actions are followable.
- Runs are capped at `MAX_AGENT_STEPS` regardless of what the model asks for.
- Stop cancels mid-action, including mid-glide.
- The system prompt refuses credentials, payment details and checkout flows.
- Only elements **visible in the viewport** are offered to the model; it cannot
  click something the user cannot see.

## Testing

Tests cover pure logic only — nothing in `tests/` imports Electron. Anything
that needs a real window belongs in a smoke script.

Extract pure functions out of Electron-importing modules so they can be tested
(`src/main/ai/cost.ts` and `context.ts` exist for exactly this reason).

When a test fails, check whether the test or the code is wrong before
"fixing" either. Of the six bugs found so far, five were real code bugs and one
was a test asserting the wrong semantics.

## Not yet built

Split view, multi-window, per-site zoom, the drag-and-drop layout editor, chord
keybindings, and semantic history search. `ROADMAP.md` has the ordering and the
reasoning.
