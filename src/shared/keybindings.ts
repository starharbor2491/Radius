/**
 * Keyboard bindings.
 *
 * A binding is a string like `Mod+Shift+T`, where `Mod` is ⌘ on macOS and Ctrl
 * everywhere else. Storing them as strings (rather than as parsed structures)
 * keeps the persisted settings human-readable and hand-editable, which matters
 * for a browser whose whole premise is that you can change everything.
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
    key
  }
}

export interface KeyEventLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Whether a keyboard event satisfies a binding.
 *
 * `Mod` deliberately accepts either ⌘ or Ctrl rather than branching on
 * platform: a binding written on a Mac still works on Linux, and the shared
 * default table stays platform-neutral.
 */
export function matchesBinding(binding: string, event: KeyEventLike): boolean {
  const parsed = parseBinding(binding)
  if (!parsed) return false

  const modPressed = event.metaKey || event.ctrlKey
  if (parsed.mod && !modPressed) return false
  if (!parsed.mod && parsed.ctrl && !event.ctrlKey) return false
  // An unmodified binding must not fire while a modifier is held.
  if (!parsed.mod && !parsed.ctrl && modPressed) return false
  if (parsed.shift !== event.shiftKey) return false
  if (parsed.alt !== event.altKey) return false

  return normaliseKey(event.key) === parsed.key
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

/** Builds a binding string from a keydown, for the "press a key" capture UI. */
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

/** Human-readable form for display, using real symbols on macOS. */
export function formatBinding(binding: string, isMac: boolean): string {
  const parsed = parseBinding(binding)
  if (!parsed) return binding

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

/** Command ids sharing a binding, so the editor can flag the clash. */
export function findConflicts(bindings: Record<string, string>): Record<string, string[]> {
  const byBinding = new Map<string, string[]>()
  for (const [commandId, binding] of Object.entries(bindings)) {
    if (!binding) continue
    const normalised = binding.toLowerCase()
    byBinding.set(normalised, [...(byBinding.get(normalised) ?? []), commandId])
  }

  const conflicts: Record<string, string[]> = {}
  for (const [binding, commandIds] of byBinding) {
    if (commandIds.length > 1) conflicts[binding] = commandIds
  }
  return conflicts
}
