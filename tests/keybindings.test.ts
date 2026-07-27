import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYBINDINGS,
  bindingFromEvent,
  findConflicts,
  formatBinding,
  matchesBinding,
  parseBinding
} from '@shared/keybindings'

const event = (overrides: Partial<Parameters<typeof matchesBinding>[1]> = {}) => ({
  key: 'k',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides
})

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
})

describe('findConflicts', () => {
  it('groups commands that share a binding', () => {
    const conflicts = findConflicts({ a: 'Mod+K', b: 'Mod+K', c: 'Mod+J' })
    expect(conflicts['mod+k']).toEqual(['a', 'b'])
    expect(conflicts['mod+j']).toBeUndefined()
  })

  it('ignores unassigned commands', () => {
    expect(findConflicts({ a: '', b: '' })).toEqual({})
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
})
