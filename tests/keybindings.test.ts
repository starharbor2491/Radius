import { describe, expect, it } from 'vitest'
import {
  CHORD_TIMEOUT_MS,
  DEFAULT_KEYBINDINGS,
  KEYBINDING_PRESETS,
  analyseConflicts,
  bindingFromEvent,
  canonicalBinding,
  countOverrides,
  detectPreset,
  findConflicts,
  formatBinding,
  isChord,
  isMacPlatform,
  keybindingPreset,
  matchesBinding,
  parseBinding,
  parseSequence,
  resolveKeyInput,
  shortcutLabel,
  splitSequence,
  type ChordPending,
  type KeyEventLike
} from '@shared/keybindings'

const event = (overrides: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: 'k',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides
})

/** A bare letter press, the raw material of every chord test below. */
const press = (key: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike =>
  event({ key, ...overrides })

describe('parseBinding', () => {
  it('splits modifiers from the key', () => {
    expect(parseBinding('Mod+Shift+T')).toEqual({
      mod: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: 't'
    })
  })

  it('accepts Cmd and Meta as aliases for Mod', () => {
    expect(parseBinding('Cmd+K')?.mod).toBe(true)
    expect(parseBinding('Meta+K')?.mod).toBe(true)
  })

  it('returns null for an empty binding', () => {
    expect(parseBinding('')).toBeNull()
  })
})

describe('parseSequence', () => {
  it('reads a single accelerator as one step', () => {
    expect(parseSequence('Mod+T')).toHaveLength(1)
  })

  it('reads a chord as several steps', () => {
    const sequence = parseSequence('g t')!
    expect(sequence).toHaveLength(2)
    expect(sequence[0]!.key).toBe('g')
    expect(sequence[1]!.key).toBe('t')
  })

  it('keeps modifiers per step', () => {
    const sequence = parseSequence('g Shift+T')!
    expect(sequence[0]!.shift).toBe(false)
    expect(sequence[1]!.shift).toBe(true)
  })

  it('tolerates sloppy spacing', () => {
    expect(splitSequence('  g   t ')).toEqual(['g', 't'])
  })

  it('rejects a sequence with an unparseable step', () => {
    expect(parseSequence('g +')).toBeNull()
    expect(parseSequence('   ')).toBeNull()
  })

  it('knows which bindings are chords', () => {
    expect(isChord('g t')).toBe(true)
    expect(isChord('Mod+Shift+T')).toBe(false)
  })
})

describe('matchesBinding', () => {
  it('matches Mod against either Cmd or Ctrl', () => {
    expect(matchesBinding('Mod+K', event({ metaKey: true }))).toBe(true)
    expect(matchesBinding('Mod+K', event({ ctrlKey: true }))).toBe(true)
  })

  it('requires the modifier', () => {
    expect(matchesBinding('Mod+K', event())).toBe(false)
  })

  it('does not fire an unmodified binding while a modifier is held', () => {
    // Otherwise "/" as a shortcut would also fire on Cmd+/.
    expect(matchesBinding('slash', event({ key: 'slash' }))).toBe(true)
    expect(matchesBinding('slash', event({ key: 'slash', metaKey: true }))).toBe(false)
  })

  it('distinguishes shift', () => {
    expect(matchesBinding('Mod+Shift+T', event({ key: 't', metaKey: true, shiftKey: true }))).toBe(true)
    expect(matchesBinding('Mod+Shift+T', event({ key: 't', metaKey: true }))).toBe(false)
    expect(matchesBinding('Mod+T', event({ key: 't', metaKey: true, shiftKey: true }))).toBe(false)
  })

  it('is case insensitive on the key', () => {
    expect(matchesBinding('Mod+T', event({ key: 'T', metaKey: true }))).toBe(true)
  })

  it('treats + and = alike so zoom works on any layout', () => {
    expect(matchesBinding('Mod+=', event({ key: '+', metaKey: true }))).toBe(true)
    expect(matchesBinding('Mod+=', event({ key: '=', metaKey: true }))).toBe(true)
  })

  it('normalises named keys', () => {
    expect(matchesBinding('esc', event({ key: 'Escape' }))).toBe(true)
    expect(matchesBinding('up', event({ key: 'ArrowUp' }))).toBe(true)
  })

  it('refuses to half-match a chord', () => {
    // One event can never satisfy `g t`; saying so is what stops a caller
    // firing the command on the first key.
    expect(matchesBinding('g t', press('g'))).toBe(false)
  })
})

describe('bindingFromEvent', () => {
  it('builds a binding string from a keypress', () => {
    expect(bindingFromEvent(event({ key: 't', metaKey: true, shiftKey: true }))).toBe('Mod+Shift+T')
  })

  it('ignores a bare modifier press', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(bindingFromEvent(event({ key }))).toBeNull()
    }
  })

  it('round-trips through matchesBinding', () => {
    const pressed = event({ key: 'j', metaKey: true, altKey: true })
    const binding = bindingFromEvent(pressed)!
    expect(matchesBinding(binding, pressed)).toBe(true)
  })
})

describe('formatBinding', () => {
  it('uses symbols on macOS and words elsewhere', () => {
    expect(formatBinding('Mod+Shift+T', true)).toBe('⌘⇧T')
    expect(formatBinding('Mod+Shift+T', false)).toBe('Ctrl+Shift+T')
  })

  it('title-cases named keys', () => {
    expect(formatBinding('Mod+esc', false)).toBe('Ctrl+Esc')
  })

  it('renders a chord as its steps, never as one combination', () => {
    expect(formatBinding('g t', false)).toBe('G T')
    expect(formatBinding('g Shift+T', true)).toBe('G ⇧T')
    expect(formatBinding('g t', false)).not.toContain('+')
  })
})

describe('shortcutLabel', () => {
  const bindings = { 'tab.new': 'Mod+T', 'tab.next': 'g t', 'tab.suspend': '' }

  it('formats for the platform rather than assuming macOS', () => {
    expect(shortcutLabel(bindings, 'tab.new', true)).toBe('⌘T')
    expect(shortcutLabel(bindings, 'tab.new', false)).toBe('Ctrl+T')
  })

  it('renders a chord as a sequence', () => {
    expect(shortcutLabel(bindings, 'tab.next', false)).toBe('G T')
  })

  it('has nothing to say about an unbound or unknown command', () => {
    expect(shortcutLabel(bindings, 'tab.suspend', false)).toBeUndefined()
    expect(shortcutLabel(bindings, 'nope', false)).toBeUndefined()
  })

  it('follows the live map, so a remap is reflected immediately', () => {
    expect(shortcutLabel({ 'tab.new': 'Mod+Shift+N' }, 'tab.new', false)).toBe('Ctrl+Shift+N')
  })
})

describe('isMacPlatform', () => {
  it('recognises what both platform APIs report', () => {
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('macOS')).toBe(true)
    expect(isMacPlatform('darwin')).toBe(true)
  })

  it('is false for everything else, including nothing', () => {
    expect(isMacPlatform('Win32')).toBe(false)
    expect(isMacPlatform('Linux x86_64')).toBe(false)
    expect(isMacPlatform(undefined)).toBe(false)
    expect(isMacPlatform('')).toBe(false)
  })
})

describe('canonicalBinding', () => {
  it('gives one spelling to every way of writing the same thing', () => {
    expect(canonicalBinding('Cmd+K')).toBe(canonicalBinding('Mod+k'))
    expect(canonicalBinding('meta+shift+t')).toBe(canonicalBinding('Mod+Shift+T'))
  })

  it('keeps chord steps distinct', () => {
    expect(canonicalBinding('g t')).toBe('g t')
    expect(canonicalBinding('g t')).not.toBe(canonicalBinding('t g'))
  })

  it('is null for nonsense', () => {
    expect(canonicalBinding('')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * The chord state machine
 * ------------------------------------------------------------------ */

describe('resolveKeyInput', () => {
  const bindings = {
    'tab.next': 'g t',
    'tab.previous': 'g Shift+T',
    'bookmarks.toggle': 'g b',
    'tab.new': 'Mod+T',
    'find.open': '/'
  }

  /** Feeds a run of keypresses through the machine, returning every step. */
  const type = (
    map: Record<string, string>,
    presses: KeyEventLike[],
    options: { now?: number; step?: number; modifiedOnly?: boolean } = {}
  ) => {
    let pending: ChordPending | null = null
    let now = options.now ?? 1_000
    const results = presses.map((one) => {
      const result = resolveKeyInput(map, one, pending, {
        now,
        ...(options.modifiedOnly === undefined ? {} : { modifiedOnly: options.modifiedOnly })
      })
      pending = result.kind === 'pending' ? result.pending : result.kind === 'ignored' ? pending : null
      now += options.step ?? 10
      return result
    })
    return results
  }

  it('fires a plain accelerator with no chord in sight', () => {
    const [result] = type(bindings, [press('t', { metaKey: true })])
    expect(result).toMatchObject({ kind: 'run', commandId: 'tab.new' })
  })

  it('waits on a prefix and then fires the chord', () => {
    const [first, second] = type(bindings, [press('g'), press('t')])
    expect(first!.kind).toBe('pending')
    expect(second).toMatchObject({ kind: 'run', commandId: 'tab.next' })
  })

  it('offers every continuation while pending', () => {
    const first = type(bindings, [press('g')])[0]!
    if (first.kind !== 'pending') throw new Error('expected pending')
    expect(first.candidates.map((candidate) => candidate.commandId).sort()).toEqual([
      'bookmarks.toggle',
      'tab.next',
      'tab.previous'
    ])
    expect(first.candidates.find((c) => c.commandId === 'tab.next')?.remaining).toBe('t')
    expect(first.pending.keys).toEqual(['G'])
  })

  it('tells two chords sharing a prefix apart by their second key', () => {
    expect(type(bindings, [press('g'), press('b')])[1]).toMatchObject({
      kind: 'run',
      commandId: 'bookmarks.toggle'
    })
    expect(type(bindings, [press('g'), press('t')])[1]).toMatchObject({
      kind: 'run',
      commandId: 'tab.next'
    })
  })

  it('distinguishes a shifted second step from an unshifted one', () => {
    const [, second] = type(bindings, [press('g'), press('T', { shiftKey: true })])
    expect(second).toMatchObject({ kind: 'run', commandId: 'tab.previous' })
  })

  it('does not break a chord when a modifier is pressed on its own', () => {
    // Reaching for Shift between `g` and `T` sends a keydown of its own.
    const results = type(bindings, [
      press('g'),
      press('Shift', { shiftKey: true }),
      press('T', { shiftKey: true })
    ])
    expect(results[1]!.kind).toBe('ignored')
    expect(results[2]).toMatchObject({ kind: 'run', commandId: 'tab.previous' })
  })

  it('abandons a prefix that has gone stale', () => {
    let pending: ChordPending | null = null
    const first = resolveKeyInput(bindings, press('g'), pending, { now: 0 })
    expect(first.kind).toBe('pending')
    pending = first.kind === 'pending' ? first.pending : null

    const late = resolveKeyInput(bindings, press('t'), pending, { now: CHORD_TIMEOUT_MS + 1 })
    // `t` alone is bound to nothing, so the whole thing evaporates rather than
    // firing "next tab" a second and a half after the user gave up on it.
    expect(late.kind).toBe('idle')
  })

  it('still fires a chord typed just inside the timeout', () => {
    const first = resolveKeyInput(bindings, press('g'), null, { now: 0 })
    const pending = first.kind === 'pending' ? first.pending : null
    const second = resolveKeyInput(bindings, press('t'), pending, { now: CHORD_TIMEOUT_MS })
    expect(second).toMatchObject({ kind: 'run', commandId: 'tab.next' })
  })

  it('lets an unknown second key stand on its own', () => {
    // `g` then `/` is not a chord, but `/` is a binding: the prefix is dropped
    // and the key gets its own turn rather than disappearing.
    const [, second] = type(bindings, [press('g'), press('/')])
    expect(second).toMatchObject({ kind: 'run', commandId: 'find.open' })
  })

  it('goes idle on an unknown second key that is bound to nothing', () => {
    const second = type(bindings, [press('g'), press('q')])[1]!
    expect(second.kind).toBe('idle')
    expect(second.pending).toBeNull()
  })

  it('passes an unbound key straight through', () => {
    const [result] = type(bindings, [press('q')])
    expect(result).toEqual({ kind: 'idle', pending: null })
  })

  it('lets an exact single-key match win where no chord could extend it', () => {
    const map = { 'find.open': '/', 'tab.next': 'g t' }
    expect(type(map, [press('/')])[0]).toMatchObject({ kind: 'run', commandId: 'find.open' })
  })

  it('waits when a prefix is also a complete binding of its own', () => {
    /*
     * `g` is bound outright and `g t` is a chord over it. The machine cannot
     * know which the user means until the next key, so it waits -- which is
     * exactly why analyseConflicts calls this shadowing.
     */
    const map = { 'sidebar.toggle': 'g', 'tab.next': 'g t' }
    const [first, second] = type(map, [press('g'), press('t')])
    expect(first!.kind).toBe('pending')
    expect(second).toMatchObject({ kind: 'run', commandId: 'tab.next' })

    // And the shadowed binding never gets its turn, even on a second key that
    // matches nothing.
    const other = type(map, [press('g'), press('q')])[1]!
    expect(other.kind).toBe('idle')
  })

  it('holds a modifier through a sequence when the binding asks for one', () => {
    const map = { 'workspace.next': 'Mod+K Mod+N' }
    const results = type(map, [press('k', { metaKey: true }), press('n', { metaKey: true })])
    expect(results[0]!.kind).toBe('pending')
    expect(results[1]).toMatchObject({ kind: 'run', commandId: 'workspace.next' })
  })

  it('ignores an unmodified binding while the focus is in a text field', () => {
    const results = type(bindings, [press('g')], { modifiedOnly: true })
    expect(results[0]!.kind).toBe('idle')
  })

  it('still fires a modified binding while the focus is in a text field', () => {
    const results = type(bindings, [press('t', { metaKey: true })], { modifiedOnly: true })
    expect(results[0]).toMatchObject({ kind: 'run', commandId: 'tab.new' })
  })

  it('leaves an in-flight chord alone when a bare modifier arrives first', () => {
    const result = resolveKeyInput(bindings, press('Meta', { metaKey: true }), null, { now: 5 })
    expect(result).toEqual({ kind: 'ignored', pending: null })
  })

  it('ignores an empty binding rather than matching everything', () => {
    const result = resolveKeyInput({ 'tab.new': '' }, press('t'), null, { now: 1 })
    expect(result.kind).toBe('idle')
  })
})

/* ------------------------------------------------------------------ *
 * Conflicts
 * ------------------------------------------------------------------ */

describe('findConflicts', () => {
  it('groups commands that share a binding', () => {
    const conflicts = findConflicts({ a: 'Mod+K', b: 'Mod+K', c: 'Mod+J' })
    expect(conflicts['mod+k']).toEqual(['a', 'b'])
    expect(conflicts['mod+j']).toBeUndefined()
  })

  it('ignores unassigned commands', () => {
    expect(findConflicts({ a: '', b: '' })).toEqual({})
  })

  it('sees through different spellings of the same shortcut', () => {
    expect(findConflicts({ a: 'Cmd+K', b: 'mod+k' })['mod+k']).toEqual(['a', 'b'])
  })

  it('does not call a chord a duplicate of its own prefix', () => {
    expect(findConflicts({ a: 'g', b: 'g t' })).toEqual({})
  })
})

describe('analyseConflicts', () => {
  it('reports a duplicate on both sides', () => {
    const conflicts = analyseConflicts({ a: 'Mod+K', b: 'Mod+K' })
    expect(conflicts.a).toEqual([{ kind: 'duplicate', commandId: 'b', binding: 'Mod+K' }])
    expect(conflicts.b).toEqual([{ kind: 'duplicate', commandId: 'a', binding: 'Mod+K' }])
  })

  it('says which of a prefix pair shadows the other', () => {
    const conflicts = analyseConflicts({ short: 'g', long: 'g t' })
    expect(conflicts.short).toEqual([{ kind: 'shadowed', commandId: 'long', binding: 'g t' }])
    expect(conflicts.long).toEqual([{ kind: 'shadows', commandId: 'short', binding: 'g' }])
  })

  it('leaves two chords sharing a prefix alone', () => {
    // `g t` and `g b` are both reachable; neither shadows the other.
    expect(analyseConflicts({ a: 'g t', b: 'g b' })).toEqual({})
  })

  it('does not confuse a chord with the combination of its keys', () => {
    expect(analyseConflicts({ a: 'g t', b: 'Mod+G' })).toEqual({})
  })

  it('reports nothing for a clean map', () => {
    expect(analyseConflicts(DEFAULT_KEYBINDINGS)).toEqual({})
  })

  it('ignores unassigned and unparseable bindings', () => {
    expect(analyseConflicts({ a: '', b: '', c: '   ' })).toEqual({})
  })
})

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

describe('preset sets', () => {
  it('ships Radius, Vim, Arc and Chrome', () => {
    expect(KEYBINDING_PRESETS.map((preset) => preset.id)).toEqual(['radius', 'vim', 'arc', 'chrome'])
  })

  it('the Radius set is what the app ships', () => {
    expect(keybindingPreset('radius')!.bindings).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('every set binds every command the defaults bind', () => {
    for (const preset of KEYBINDING_PRESETS) {
      for (const commandId of Object.keys(DEFAULT_KEYBINDINGS)) {
        expect(preset.bindings[commandId], `${preset.id}/${commandId}`).toBeTruthy()
      }
    }
  })

  it('every set parses', () => {
    for (const preset of KEYBINDING_PRESETS) {
      for (const [commandId, binding] of Object.entries(preset.bindings)) {
        expect(parseSequence(binding), `${preset.id}/${commandId}`).not.toBeNull()
      }
    }
  })

  it('no set contains a duplicate or a shadowed binding', () => {
    for (const preset of KEYBINDING_PRESETS) {
      expect(analyseConflicts(preset.bindings), preset.id).toEqual({})
    }
  })

  it('the Vim set actually uses chords', () => {
    const vim = keybindingPreset('vim')!.bindings
    expect(vim['tab.next']).toBe('g t')
    expect(isChord(vim['tab.previous']!)).toBe(true)
  })

  it('detects which set a map is', () => {
    expect(detectPreset(DEFAULT_KEYBINDINGS)).toBe('radius')
    expect(detectPreset(keybindingPreset('vim')!.bindings)).toBe('vim')
  })

  it('detects nothing for a map of the user\'s own', () => {
    expect(detectPreset({ ...DEFAULT_KEYBINDINGS, 'tab.new': 'Mod+Alt+N' })).toBeNull()
  })

  it('is not fooled by a different spelling of the same set', () => {
    expect(detectPreset({ ...DEFAULT_KEYBINDINGS, 'tab.new': 'Cmd+t' })).toBe('radius')
  })

  it('counts a user\'s own edits on top of a set', () => {
    const vim = keybindingPreset('vim')!.bindings
    expect(countOverrides(vim, 'vim')).toBe(0)
    expect(countOverrides({ ...vim, 'tab.new': 'Mod+Alt+N' }, 'vim')).toBe(1)
    expect(countOverrides({ ...vim, 'tab.new': 'Mod+Alt+N', 'tab.close': '' }, 'vim')).toBe(2)
  })

  it('has nothing to count against a set that does not exist', () => {
    expect(countOverrides(DEFAULT_KEYBINDINGS, 'nope')).toBe(0)
  })
})

describe('the shipped defaults', () => {
  it('assign no shortcut twice', () => {
    expect(findConflicts(DEFAULT_KEYBINDINGS)).toEqual({})
  })

  it('all parse', () => {
    for (const [commandId, binding] of Object.entries(DEFAULT_KEYBINDINGS)) {
      expect(parseBinding(binding), commandId).not.toBeNull()
    }
  })

  it('are all single accelerators, so nothing swallows a keystroke by default', () => {
    for (const [commandId, binding] of Object.entries(DEFAULT_KEYBINDINGS)) {
      expect(isChord(binding), commandId).toBe(false)
    }
  })
})
