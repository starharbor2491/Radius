/**
 * Keyboard bindings.
 *
 * A binding is a string like `Mod+Shift+T`, where `Mod` is ⌘ on macOS and Ctrl
 * everywhere else. Storing them as strings (rather than as parsed structures)
 * keeps the persisted settings human-readable and hand-editable, which matters
 * for a browser whose whole premise is that you can change everything.
 *
 * A binding may also be a *chord*: several steps separated by spaces, as in
 * `g t`. Spaces are safe as the separator because no step ever contains one --
 * the space bar normalises to the word `space`.
 *
 * Chords need a matcher with memory, and that matcher is the most dangerous
 * code in the renderer: a state machine that swallows one key too many turns
 * every text field in the chrome into a black hole. It therefore lives here,
 * as a pure function of (bindings, event, pending state), and is unit tested
 * adversarially rather than being written inline in a hook.
 */

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'tab.new': 'Mod+T',
  'tab.close': 'Mod+W',
  'tab.reopen': 'Mod+Shift+T',
  'tab.reload': 'Mod+R',
  'tab.pin': 'Mod+Shift+P',
  'tab.next': 'Ctrl+Tab',
  'tab.previous': 'Ctrl+Shift+Tab',
  'omnibox.focus': 'Mod+L',
  'palette.open': 'Mod+K',
  'find.open': 'Mod+F',
  'sidebar.toggle': 'Mod+B',
  'ai.toggle': 'Mod+J',
  'ai.summarize': 'Mod+Shift+S',
  'agent.toggle': 'Mod+Shift+A',
  'history.open': 'Mod+Y',
  'downloads.open': 'Mod+Shift+J',
  'bookmark.add': 'Mod+D',
  'bookmarks.toggle': 'Mod+Shift+B',
  'workspace.new': 'Mod+Shift+N',
  'workspace.next': 'Mod+Shift+]',
  'workspace.previous': 'Mod+Shift+[',
  'theme.open': 'Mod+Shift+,',
  'settings.open': 'Mod+,',
  'zoom.in': 'Mod+=',
  'zoom.out': 'Mod+-',
  'zoom.reset': 'Mod+0'
}

/**
 * How long a half-typed chord waits for its next step before giving up.
 *
 * Long enough to be typed deliberately, short enough that a forgotten prefix
 * does not eat a keystroke a second later.
 */
export const CHORD_TIMEOUT_MS = 1200

/** How many steps a binding may have. Two is what `g t` needs; three is noise. */
export const MAX_CHORD_STEPS = 2

export interface ParsedBinding {
  mod: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const key = parts[parts.length - 1]!.toLowerCase()
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase())

  return {
    mod: modifiers.includes('mod') || modifiers.includes('cmd') || modifiers.includes('meta'),
    ctrl: modifiers.includes('ctrl') || modifiers.includes('control'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt') || modifiers.includes('option'),
    key: normaliseKey(key)
  }
}

/** The individual steps of a binding, or `null` if any of them is unparseable. */
export function splitSequence(binding: string): string[] {
  return binding.split(/\s+/).filter(Boolean)
}

export function parseSequence(binding: string): ParsedBinding[] | null {
  const steps = splitSequence(binding)
  if (steps.length === 0) return null

  const parsed: ParsedBinding[] = []
  for (const step of steps) {
    const one = parseBinding(step)
    if (!one) return null
    parsed.push(one)
  }
  return parsed
}

/** True when a binding needs more than one keypress. */
export function isChord(binding: string): boolean {
  return splitSequence(binding).length > 1
}

export interface KeyEventLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Whether one keypress satisfies one parsed step.
 *
 * `Mod` deliberately accepts either ⌘ or Ctrl rather than branching on
 * platform: a binding written on a Mac still works on Linux, and the shared
 * default table stays platform-neutral.
 */
export function matchesStep(step: ParsedBinding, event: KeyEventLike): boolean {
  const modPressed = event.metaKey || event.ctrlKey
  if (step.mod && !modPressed) return false
  if (!step.mod && step.ctrl && !event.ctrlKey) return false
  // An unmodified binding must not fire while a modifier is held.
  if (!step.mod && !step.ctrl && modPressed) return false
  if (step.shift !== event.shiftKey) return false
  if (step.alt !== event.altKey) return false

  return normaliseKey(event.key) === step.key
}

/**
 * Whether a keyboard event satisfies a binding.
 *
 * Single-step only: a chord cannot be decided by one event, so this answers
 * `false` for one rather than half-matching it. Use `resolveKeyInput` for the
 * general case.
 */
export function matchesBinding(binding: string, event: KeyEventLike): boolean {
  const sequence = parseSequence(binding)
  if (!sequence || sequence.length !== 1) return false
  return matchesStep(sequence[0]!, event)
}

/** A step that carries a real modifier is safe to fire while typing. */
export function stepHasModifier(step: ParsedBinding): boolean {
  // Shift alone does not count: Shift+T is how you type a capital T.
  return step.mod || step.ctrl || step.alt
}

function normaliseKey(key: string): string {
  if (key === ' ') return 'space'
  if (key === 'Escape') return 'esc'
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowDown') return 'down'
  if (key === 'ArrowLeft') return 'left'
  if (key === 'ArrowRight') return 'right'
  // `Mod+=` and `Mod++` both mean "zoom in" to a user; treat them alike.
  if (key === '+') return '='
  return key.toLowerCase()
}

/** Builds a single binding step from a keydown, for the "press a key" capture UI. */
export function bindingFromEvent(event: KeyEventLike): string | null {
  const key = normaliseKey(event.key)
  if (['control', 'shift', 'alt', 'meta', 'os'].includes(key)) return null

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

/**
 * Human-readable form for display, using real symbols on macOS.
 *
 * A chord is rendered as its steps in order (`G T`), never fused into one
 * combination -- `G+T` would read as "hold both", which is the opposite of
 * what a chord means.
 */
export function formatBinding(binding: string, isMac: boolean): string {
  const steps = splitSequence(binding)
  if (steps.length === 0) return binding
  return steps.map((step) => formatStep(step, isMac)).join(' ')
}

/**
 * The label a menu or palette should print for a command.
 *
 * Derived from the live map on purpose: a hardcoded `⌘T` is wrong on Linux,
 * and goes stale the moment the user remaps the command -- which is the entire
 * point of having a remapper.
 */
export function shortcutLabel(
  bindings: Record<string, string>,
  commandId: string,
  isMac: boolean
): string | undefined {
  const binding = bindings[commandId]
  if (!binding) return undefined
  if (!parseSequence(binding)) return undefined
  return formatBinding(binding, isMac)
}

/**
 * A binding as an Electron accelerator, or `null` when it cannot be one.
 *
 * The native menu has to agree with the rest of the app: with a hardcoded
 * accelerator, applying the Vim set left Cmd+T still opening a tab from the
 * File menu, and remapping a command silently did nothing to its menu item.
 *
 * Chords return `null` rather than a lie. An Electron accelerator is a single
 * combination and cannot express a sequence, so a command bound to `g t` gets a
 * menu item with no accelerator -- the item still works, and the shortcut still
 * works through the renderer's own matcher. Printing "G T" there would be a
 * key combination the OS would refuse to register.
 */
export function electronAccelerator(binding: string): string | null {
  if (isChord(binding)) return null
  const parsed = parseBinding(binding)
  if (!parsed) return null

  const parts: string[] = []
  if (parsed.mod) parts.push('CmdOrCtrl')
  if (parsed.ctrl && !parsed.mod) parts.push('Control')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')

  const key = ACCELERATOR_KEYS[parsed.key] ?? parsed.key
  if (!key) return null
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

/** Key names Electron spells differently from a DOM `KeyboardEvent.key`. */
const ACCELERATOR_KEYS: Record<string, string> = {
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  escape: 'Esc',
  ' ': 'Space',
  enter: 'Return',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  '+': 'Plus',
  '=': 'Plus',
  '-': '-'
}

/**
 * Whether a platform string names a Mac.
 *
 * `navigator.platform` is deprecated but still the only thing every Electron
 * version agrees on, and `userAgentData.platform` spells it "macOS", so both
 * shapes have to be accepted.
 */
export function isMacPlatform(platform: string | undefined | null): boolean {
  if (!platform) return false
  const value = platform.toLowerCase()
  return value.startsWith('mac') || value.startsWith('darwin') || value === 'iphone' || value === 'ipad'
}

function formatStep(step: string, isMac: boolean): string {
  const parsed = parseBinding(step)
  if (!parsed) return step

  const parts: string[] = []
  if (parsed.mod) parts.push(isMac ? '⌘' : 'Ctrl')
  if (parsed.ctrl && !parsed.mod) parts.push(isMac ? '⌃' : 'Ctrl')
  if (parsed.alt) parts.push(isMac ? '⌥' : 'Alt')
  if (parsed.shift) parts.push(isMac ? '⇧' : 'Shift')
  parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : titleCase(parsed.key))

  return isMac ? parts.join('') : parts.join('+')
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * One canonical spelling per binding, so `Cmd+K`, `meta+k` and `Mod+K` compare
 * equal. Returns `null` for anything that does not parse.
 */
export function canonicalBinding(binding: string): string | null {
  const sequence = parseSequence(binding)
  if (!sequence) return null
  return sequence.map(canonicalStep).join(' ')
}

function canonicalStep(step: ParsedBinding): string {
  const parts: string[] = []
  if (step.mod) parts.push('mod')
  if (step.ctrl && !step.mod) parts.push('ctrl')
  if (step.alt) parts.push('alt')
  if (step.shift) parts.push('shift')
  parts.push(step.key)
  return parts.join('+')
}

/* ------------------------------------------------------------------ *
 * The chord state machine
 * ------------------------------------------------------------------ */

/** A chord that has begun but not finished. Serialisable on purpose. */
export interface ChordPending {
  /** The keypresses consumed so far, in order. */
  pressed: KeyEventLike[]
  /** Those keypresses as binding steps, for display. */
  keys: string[]
  /** When the last step landed, so the timeout can be evaluated purely. */
  at: number
}

/** A binding that the pending prefix could still grow into. */
export interface ChordCandidate {
  commandId: string
  binding: string
  /** The steps still to be typed, e.g. `t` for `g t` after `g`. */
  remaining: string
}

export type ChordResolution =
  /** Nothing matched. The key belongs to whoever else wants it. */
  | { kind: 'idle'; pending: null }
  /** A bare modifier press. Held modifiers must not break a chord in progress. */
  | { kind: 'ignored'; pending: ChordPending | null }
  /** Consumed as a prefix. The caller should swallow the key and show the hint. */
  | { kind: 'pending'; pending: ChordPending; candidates: ChordCandidate[] }
  /** A complete binding. Fire it. */
  | { kind: 'run'; pending: null; commandId: string; binding: string }

export interface ChordResolveOptions {
  /** Injectable clock; the timeout is evaluated, never scheduled, in here. */
  now?: number
  timeoutMs?: number
  /**
   * Only consider bindings whose first step carries a modifier. Set while the
   * focus is in a text field, where a bare `g` has to reach the field.
   */
  modifiedOnly?: boolean
}

/**
 * Advances the chord machine by one keypress.
 *
 * The rules, in order:
 *
 * 1. A bare modifier press changes nothing -- holding Shift through `g` `T`
 *    must not abandon the prefix.
 * 2. A pending prefix older than the timeout is discarded before matching, so
 *    a forgotten `g` never silently eats the next keystroke.
 * 3. If any binding could still *extend* what has been typed, the key is
 *    consumed and the machine waits. This is what makes `g t` work, and it is
 *    also why `g` alone is shadowed by `g t` -- see `analyseConflicts`.
 * 4. Otherwise an exact match fires. An unmodified single key still wins as
 *    long as no chord could have extended it.
 * 5. A prefix that leads nowhere is abandoned and the key is re-evaluated on
 *    its own, so an unknown second key still triggers its own binding rather
 *    than vanishing.
 */
export function resolveKeyInput(
  bindings: Record<string, string>,
  event: KeyEventLike,
  pending: ChordPending | null,
  options: ChordResolveOptions = {}
): ChordResolution {
  const now = options.now ?? Date.now()
  const timeoutMs = options.timeoutMs ?? CHORD_TIMEOUT_MS

  const display = bindingFromEvent(event)
  if (!display) return { kind: 'ignored', pending }

  const live = pending && now - pending.at <= timeoutMs ? pending : null

  if (live) {
    const extended = attempt(
      bindings,
      [...live.pressed, event],
      [...live.keys, display],
      now,
      options
    )
    if (extended.kind !== 'idle') return extended
  }

  return attempt(bindings, [event], [display], now, options)
}

function attempt(
  bindings: Record<string, string>,
  pressed: KeyEventLike[],
  keys: string[],
  now: number,
  options: ChordResolveOptions
): ChordResolution {
  let exact: { commandId: string; binding: string } | null = null
  const candidates: ChordCandidate[] = []

  for (const [commandId, binding] of Object.entries(bindings)) {
    if (!binding) continue
    const sequence = parseSequence(binding)
    if (!sequence || sequence.length < pressed.length) continue
    if (options.modifiedOnly && !stepHasModifier(sequence[0]!)) continue

    let matched = true
    for (let index = 0; index < pressed.length; index += 1) {
      if (!matchesStep(sequence[index]!, pressed[index]!)) {
        matched = false
        break
      }
    }
    if (!matched) continue

    if (sequence.length === pressed.length) {
      // First writer wins, so the map's own order decides a duplicate.
      if (!exact) exact = { commandId, binding }
    } else {
      candidates.push({
        commandId,
        binding,
        remaining: splitSequence(binding).slice(pressed.length).join(' ')
      })
    }
  }

  if (candidates.length > 0) {
    return { kind: 'pending', pending: { pressed, keys, at: now }, candidates }
  }
  if (exact) return { kind: 'run', pending: null, ...exact }
  return { kind: 'idle', pending: null }
}

/* ------------------------------------------------------------------ *
 * Conflicts
 * ------------------------------------------------------------------ */

/** Command ids sharing a binding, so the editor can flag the clash. */
export function findConflicts(bindings: Record<string, string>): Record<string, string[]> {
  const byBinding = new Map<string, string[]>()
  for (const [commandId, binding] of Object.entries(bindings)) {
    if (!binding) continue
    const normalised = canonicalBinding(binding)
    if (!normalised) continue
    byBinding.set(normalised, [...(byBinding.get(normalised) ?? []), commandId])
  }

  const conflicts: Record<string, string[]> = {}
  for (const [binding, commandIds] of byBinding) {
    if (commandIds.length > 1) conflicts[binding] = commandIds
  }
  return conflicts
}

export type ConflictKind =
  /** Two commands hold the same binding; only the first one can ever fire. */
  | 'duplicate'
  /** This binding is a chord whose prefix is somebody else's whole binding. */
  | 'shadows'
  /** Somebody else's chord starts with this binding, so this one never fires. */
  | 'shadowed'

export interface KeybindingConflict {
  kind: ConflictKind
  /** The command on the other side of the clash. */
  commandId: string
  binding: string
}

/**
 * Conflicts per command, chord-aware.
 *
 * Two commands on `Mod+K` is a plain duplicate. `g` against `g t` is not: both
 * are typeable, but because the machine waits to see whether `g` grows into
 * `g t`, the bare `g` can never fire. That is a real defect and a different
 * sentence, so the editor gets told which side of it each command is on.
 */
export function analyseConflicts(
  bindings: Record<string, string>
): Record<string, KeybindingConflict[]> {
  const entries = Object.entries(bindings)
    .filter(([, binding]) => Boolean(binding))
    .map(([commandId, binding]) => ({
      commandId,
      binding,
      steps: canonicalBinding(binding)?.split(' ') ?? null
    }))
    .filter((entry): entry is { commandId: string; binding: string; steps: string[] } =>
      entry.steps !== null
    )

  const result: Record<string, KeybindingConflict[]> = {}
  const add = (commandId: string, conflict: KeybindingConflict): void => {
    result[commandId] = [...(result[commandId] ?? []), conflict]
  }

  for (const a of entries) {
    for (const b of entries) {
      if (a.commandId === b.commandId) continue
      if (sameSteps(a.steps, b.steps)) {
        add(a.commandId, { kind: 'duplicate', commandId: b.commandId, binding: b.binding })
      } else if (isPrefixOf(a.steps, b.steps)) {
        // b is the longer chord, so b shadows a.
        add(a.commandId, { kind: 'shadowed', commandId: b.commandId, binding: b.binding })
        add(b.commandId, { kind: 'shadows', commandId: a.commandId, binding: a.binding })
      }
    }
  }
  return result
}

function sameSteps(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((step, index) => step === b[index])
}

function isPrefixOf(short: string[], long: string[]): boolean {
  if (short.length >= long.length) return false
  return short.every((step, index) => step === long[index])
}

/* ------------------------------------------------------------------ *
 * Preset sets
 * ------------------------------------------------------------------ */

export interface KeybindingPreset {
  id: string
  name: string
  description: string
  bindings: Record<string, string>
}

export const DEFAULT_KEYBINDING_PRESET = 'radius'

/**
 * A preset is spread over the defaults rather than written from scratch, so
 * adding a command later cannot leave a preset with a hole in it -- the new
 * command keeps its default binding until a preset says otherwise.
 */
function preset(
  id: string,
  name: string,
  description: string,
  overrides: Record<string, string>
): KeybindingPreset {
  return { id, name, description, bindings: { ...DEFAULT_KEYBINDINGS, ...overrides } }
}

export const KEYBINDING_PRESETS: KeybindingPreset[] = [
  preset('radius', 'Radius', 'What Radius ships with: modifier shortcuts, no chords.', {}),

  preset(
    'vim',
    'Vim',
    'Modeless single keys and `g` chords, in the style of Vimium. Bare keys still yield to any text field you are typing in.',
    {
      'tab.new': 't',
      'tab.close': 'x',
      'tab.reopen': 'Shift+X',
      'tab.reload': 'r',
      'tab.next': 'g t',
      'tab.previous': 'g Shift+T',
      'tab.pin': 'g p',
      'omnibox.focus': 'o',
      'find.open': '/',
      'sidebar.toggle': 'g s',
      'ai.toggle': 'g a',
      'ai.summarize': 'g Shift+S',
      'agent.toggle': 'g Shift+A',
      'history.open': 'g h',
      'downloads.open': 'g d',
      'bookmark.add': 'g m',
      'bookmarks.toggle': 'g b',
      'workspace.new': 'g n',
      'workspace.next': 'g ]',
      'workspace.previous': 'g [',
      'theme.open': 'g c',
      'settings.open': 'g ,',
      'zoom.in': '=',
      'zoom.out': '-',
      'zoom.reset': '0'
    }
  ),

  preset('arc', 'Arc', 'Command bar on ⌘T, sidebar on ⌘S, spaces on ⌘⌥←/→.', {
    'palette.open': 'Mod+T',
    'tab.new': 'Mod+N',
    'sidebar.toggle': 'Mod+S',
    'workspace.next': 'Mod+Alt+right',
    'workspace.previous': 'Mod+Alt+left',
    'ai.summarize': 'Mod+Shift+I'
  }),

  preset('chrome', 'Chrome', 'The browser standards, with tab search on ⌘⇧A.', {
    'palette.open': 'Mod+Shift+A',
    'agent.toggle': 'Mod+Shift+G',
    'sidebar.toggle': 'Mod+Shift+E'
  })
]

export function keybindingPreset(id: string): KeybindingPreset | null {
  return KEYBINDING_PRESETS.find((candidate) => candidate.id === id) ?? null
}

/**
 * Which preset a map is exactly, if any.
 *
 * Used to label an installation that predates preset sets. Recording the
 * answer must never rewrite the map -- see `keybindings:setPreset`.
 */
export function detectPreset(bindings: Record<string, string>): string | null {
  for (const candidate of KEYBINDING_PRESETS) {
    if (countOverrides(bindings, candidate.id) === 0) return candidate.id
  }
  return null
}

/** How many bindings the user has changed relative to a preset. */
export function countOverrides(bindings: Record<string, string>, presetId: string): number {
  const base = keybindingPreset(presetId)
  if (!base) return 0

  const keys = new Set([...Object.keys(base.bindings), ...Object.keys(bindings)])
  let changed = 0
  for (const key of keys) {
    const mine = canonicalBinding(bindings[key] ?? '') ?? ''
    const theirs = canonicalBinding(base.bindings[key] ?? '') ?? ''
    if (mine !== theirs) changed += 1
  }
  return changed
}
