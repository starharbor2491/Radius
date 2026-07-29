import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Tab } from '@shared/types'
import {
  CHORD_TIMEOUT_MS,
  DEFAULT_KEYBINDINGS,
  isMacPlatform,
  resolveKeyInput,
  shortcutLabel,
  type ChordPending
} from '@shared/keybindings'
import { QUICK_ACTIONS } from '@shared/quick-actions'
import { bridge, send } from './bridge'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { useTheme } from '../theme/ThemeProvider'

export interface Command {
  id: string
  title: string
  /**
   * Derived from the live binding map, never hardcoded: a literal `⌘T` here
   * would be wrong on Linux and stale the moment the user remaps it.
   */
  shortcut?: string
  /** Section heading for the palette. */
  group?: string
  enabled?: boolean
  run: () => void
}

/** What the platform actually is, for shortcut rendering. */
export function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  return isMacPlatform(data?.platform ?? navigator.platform)
}

/* ------------------------------------------------------------------ *
 * The live binding map
 * ------------------------------------------------------------------ */

/*
 * One subscription for the whole renderer. The registry, the dispatcher and
 * the editor all need the same map, and three independent copies is three
 * chances to disagree about what `⌘K` does.
 */
let bindingsSnapshot: Record<string, string> = DEFAULT_KEYBINDINGS
const bindingListeners = new Set<() => void>()
let bindingsStarted = false

function publishBindings(next: Record<string, string>): void {
  bindingsSnapshot = next
  for (const listener of bindingListeners) listener()
}

function subscribeBindings(listener: () => void): () => void {
  bindingListeners.add(listener)
  if (!bindingsStarted) {
    bindingsStarted = true
    void bridge
      .invoke('keybindings:get', {})
      .then((stored) => publishBindings({ ...DEFAULT_KEYBINDINGS, ...stored }))
    // Settings writes bindings and pushes a snapshot; re-read on every change.
    bridge.on('state:changed', (snapshot) => {
      const stored = snapshot.settings.keybindings
      if (stored && typeof stored === 'object') {
        publishBindings({ ...DEFAULT_KEYBINDINGS, ...(stored as Record<string, string>) })
      }
    })
  }
  return () => bindingListeners.delete(listener)
}

/** The user's bindings, merged over the defaults, kept live. */
export function useKeybindings(): Record<string, string> {
  return useSyncExternalStore(
    subscribeBindings,
    () => bindingsSnapshot,
    () => bindingsSnapshot
  )
}

/* ------------------------------------------------------------------ *
 * The pending-chord hint
 * ------------------------------------------------------------------ */

export interface ChordHintCandidate {
  commandId: string
  /** The steps still to be typed, e.g. `t` for `g t` after `g`. */
  remaining: string
  title: string
}

export interface ChordHint {
  /** What has been typed so far, as binding steps. */
  keys: string[]
  candidates: ChordHintCandidate[]
}

let chordSnapshot: ChordHint | null = null
const chordListeners = new Set<() => void>()

function publishChord(next: ChordHint | null): void {
  chordSnapshot = next
  for (const listener of chordListeners) listener()
}

function subscribeChord(listener: () => void): () => void {
  chordListeners.add(listener)
  return () => chordListeners.delete(listener)
}

/**
 * The half-typed chord, if there is one.
 *
 * A chord that swallows a key with no feedback is indistinguishable from a
 * broken keyboard, so this exists purely so something can say so on screen.
 */
export function usePendingChord(): ChordHint | null {
  return useSyncExternalStore(
    subscribeChord,
    () => chordSnapshot,
    () => null
  )
}

/**
 * The single command registry.
 *
 * The native menu, the keyboard, and ⌘K all dispatch through these ids, so a
 * command's behaviour is defined exactly once. Main sends menu accelerators
 * back as `command:invoke` events rather than duplicating the logic.
 */
export function useCommands(): Command[] {
  const activeTab = useActiveTab()
  const allTabs = useAppStore((store) => store.state.tabs)
  const workspaces = useAppStore((store) => store.state.workspaces)
  const activeWorkspaceId = useAppStore((store) => store.state.activeWorkspaceId)
  const ui = useUiStore()
  const { theme, presets, applyPreset, applyTheme, update } = useTheme()
  const bindings = useKeybindings()
  const isMac = useMemo(detectIsMac, [])

  const commands = useMemo<Command[]>(() => {
    const withTab = (fn: (tab: Tab) => void) => () => {
      if (activeTab) fn(activeTab)
    }

    /** Wraps around at both ends, which is what every other browser does. */
    const cycleTab = (delta: number): void => {
      if (!activeWorkspaceId) return
      const siblings = allTabs
        .filter((tab) => tab.workspaceId === activeWorkspaceId)
        .sort((a, b) => a.order - b.order)
      if (siblings.length === 0) return
      const index = siblings.findIndex((tab) => tab.id === activeTab?.id)
      const next = siblings[(index + delta + siblings.length) % siblings.length]
      if (next) send('tabs:activate', { tabId: next.id })
    }

    const cycleWorkspace = (delta: number): void => {
      if (workspaces.length === 0) return
      const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId)
      const next = workspaces[(index + delta + workspaces.length) % workspaces.length]
      if (next) send('workspaces:activate', { workspaceId: next.id })
    }

    const base: Command[] = [
      { id: 'tab.new', title: 'New tab', group: 'Tabs', run: () => send('tabs:create', {}) },
      {
        id: 'tab.close',
        title: 'Close tab',
        group: 'Tabs',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:close', { tabId: tab.id }))
      },
      {
        id: 'tab.reopen',
        title: 'Reopen closed tab',
        group: 'Tabs',
        run: () => send('tabs:reopenClosed', {})
      },
      {
        id: 'tab.reload',
        title: 'Reload page',
        group: 'Navigation',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:reload', { tabId: tab.id }))
      },
      {
        id: 'tab.pin',
        title: activeTab?.pinned ? 'Unpin tab' : 'Pin tab',
        group: 'Tabs',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:setPinned', { tabId: tab.id, pinned: !tab.pinned }))
      },
      {
        id: 'tab.suspend',
        title: 'Suspend tab',
        group: 'Tabs',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:suspend', { tabId: tab.id }))
      },
      {
        id: 'tab.aiContext',
        title: activeTab?.inAiContext ? 'Remove tab from AI context' : 'Add tab to AI context',
        group: 'AI',
        enabled: Boolean(activeTab),
        run: withTab((tab) =>
          send('tabs:setAiContext', { tabId: tab.id, inContext: !tab.inAiContext })
        )
      },
      {
        id: 'group.new',
        title: 'Group this tab',
        group: 'Tabs',
        enabled: Boolean(activeTab),
        run: withTab((tab) =>
          send('groups:create', {
            workspaceId: tab.workspaceId,
            title: 'New group',
            color: 'blue',
            tabIds: [tab.id]
          })
        )
      },
      {
        id: 'workspace.new',
        title: 'New workspace',
        group: 'Workspaces',
        run: () => send('workspaces:create', { name: `Workspace ${workspaces.length + 1}`, icon: '◈' })
      },
      {
        id: 'bookmark.add',
        title: 'Bookmark this page',
        group: 'Bookmarks',
        enabled: Boolean(activeTab?.url),
        run: withTab((tab) =>
          send('bookmarks:create', {
            url: tab.url,
            title: tab.title || tab.url,
            faviconUrl: tab.faviconUrl
          })
        )
      },
      {
        id: 'omnibox.focus',
        title: 'Focus address bar',
        group: 'Navigation',
        run: () => window.dispatchEvent(new Event('radius:focus-omnibox'))
      },
      {
        id: 'palette.open',
        title: 'Command palette',
        group: 'Window',
        run: () => ui.setPaletteOpen(true)
      },
      { id: 'sidebar.toggle', title: 'Toggle sidebar', group: 'Window', run: ui.toggleSidebar },
      {
        id: 'bookmarks.toggle',
        title: 'Toggle bookmarks',
        group: 'Bookmarks',
        run: ui.toggleBookmarks
      },
      { id: 'ai.toggle', title: 'Toggle AI panel', group: 'AI', run: () => ui.toggleRightPanel('ai') },
      {
        id: 'agent.toggle',
        title: 'Let the assistant drive this page',
        group: 'AI',
        run: () => ui.toggleRightPanel('agent')
      },
      {
        id: 'theme.open',
        title: 'Theme studio',
        group: 'Appearance',
        run: () => ui.toggleRightPanel('theme')
      },
      {
        id: 'settings.open',
        title: 'Settings',
        group: 'Window',
        run: () => ui.toggleRightPanel('settings')
      },
      {
        id: 'theme.import',
        title: 'Import theme from file…',
        group: 'Appearance',
        run: () => {
          // An imported document is not a preset -- it is a whole theme, and
          // applying it by id would silently do nothing.
          void bridge.invoke('theme:importFile', {}).then((imported) => {
            if (imported.status === 'imported' && imported.theme) applyTheme(imported.theme)
            else if (imported.status === 'failed') {
              ui.showToast(
                imported.error || `Theme file rejected: ${imported.issues[0]?.path ?? 'unknown'}`
              )
            }
          })
        }
      },
      {
        id: 'theme.export',
        title: 'Export theme to file…',
        group: 'Appearance',
        run: () => send('theme:exportFile', { theme })
      },
      {
        id: 'motion.cycle',
        title: `Motion: ${theme.motion.enabled ? `${theme.motion.scale}×` : 'off'} — cycle preset`,
        group: 'Appearance',
        run: () => {
          // reduced -> snappy -> balanced -> expressive -> reduced
          const steps = [
            { enabled: false, scale: 1 },
            { enabled: true, scale: 0.7 },
            { enabled: true, scale: 1 },
            { enabled: true, scale: 1.35 }
          ]
          const currentIndex = steps.findIndex(
            (step) => step.enabled === theme.motion.enabled && step.scale === theme.motion.scale
          )
          const next = steps[(currentIndex + 1) % steps.length]!
          update({ motion: next })
        }
      },
      {
        id: 'find.open',
        title: 'Find in page',
        group: 'Navigation',
        enabled: Boolean(activeTab),
        run: () => ui.setFindOpen(true)
      },
      {
        id: 'history.open',
        title: 'History',
        group: 'Navigation',
        run: () => ui.toggleRightPanel('history')
      },
      {
        id: 'downloads.open',
        title: 'Downloads',
        group: 'Navigation',
        run: () => ui.toggleRightPanel('downloads')
      },
      {
        id: 'usage.open',
        title: 'AI usage and budget',
        group: 'AI',
        run: () => ui.toggleRightPanel('usage')
      },
      {
        id: 'zoom.in',
        title: 'Zoom in',
        group: 'Navigation',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('zoom:step', { tabId: tab.id, direction: 'in' }))
      },
      {
        id: 'zoom.out',
        title: 'Zoom out',
        group: 'Navigation',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('zoom:step', { tabId: tab.id, direction: 'out' }))
      },
      {
        id: 'zoom.reset',
        title: 'Reset zoom',
        group: 'Navigation',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('zoom:step', { tabId: tab.id, direction: 'reset' }))
      },
      {
        id: 'tab.next',
        title: 'Next tab',
        group: 'Tabs',
        run: () => cycleTab(1)
      },
      {
        id: 'tab.previous',
        title: 'Previous tab',
        group: 'Tabs',
        run: () => cycleTab(-1)
      },
      {
        id: 'workspace.next',
        title: 'Next workspace',
        group: 'Workspaces',
        run: () => cycleWorkspace(1)
      },
      {
        id: 'workspace.previous',
        title: 'Previous workspace',
        group: 'Workspaces',
        run: () => cycleWorkspace(-1)
      },
      {
        id: 'workspace.delete',
        title: 'Delete this workspace',
        group: 'Workspaces',
        enabled: workspaces.length > 1 && Boolean(activeWorkspaceId),
        run: () => {
          if (activeWorkspaceId) send('workspaces:delete', { workspaceId: activeWorkspaceId })
        }
      }
    ]

    // Every preset is a command, so switching theme never needs the mouse.
    const presetCommands = presets.map<Command>((preset) => ({
      id: `theme.preset.${preset.id}`,
      title: `Theme: ${preset.name}`,
      group: 'Appearance',
      run: () => applyPreset(preset.id)
    }))

    /*
     * Quick actions are commands too, so ⌘K can run "Summarize page" directly.
     * They open the AI panel first, then fire an event the panel listens for --
     * the panel owns the provider/model selection, so it has to be the thing
     * that actually dispatches.
     */
    const quickActionCommands = QUICK_ACTIONS.map<Command>((action) => ({
      id: `ai.${action.id}`,
      title: action.label,
      group: 'AI',
      enabled: Boolean(activeTab),
      run: () => {
        ui.setRightPanel('ai')
        window.dispatchEvent(new CustomEvent('radius:quick-action', { detail: action.id }))
      }
    }))

    /*
     * The label is applied here, once, from the live map: there is exactly one
     * source of truth for what a command's shortcut is, and remapping updates
     * every surface that shows it.
     */
    return [...base, ...presetCommands, ...quickActionCommands].map((command) => ({
      ...command,
      shortcut: shortcutLabel(bindings, command.id, isMac)
    }))
  }, [
    activeTab,
    allTabs,
    workspaces,
    activeWorkspaceId,
    ui,
    theme,
    presets,
    applyPreset,
    applyTheme,
    update,
    bindings,
    isMac
  ])

  return commands
}

/**
 * Whether a keypress belongs to something the user is typing into.
 *
 * Chords make this load bearing. With only modifier accelerators an errant
 * match was merely annoying; a bare `g` bound to a chord prefix would swallow
 * the letter g out of the omnibox, so text fields only ever see bindings whose
 * first step carries a real modifier.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return element.isContentEditable === true
}

/**
 * Wires menu accelerators and the user's own keybindings to the registry.
 *
 * Bindings are read from main rather than hardcoded, so remapping a shortcut in
 * Settings takes effect without a restart. Chord matching runs through the
 * shared state machine; everything here is plumbing around it -- swallow the
 * key while a prefix is pending, publish the hint, and abandon the prefix on a
 * real clock once the timeout passes.
 */
export function useCommandDispatch(commands: Command[]): void {
  const bindings = useKeybindings()
  const pendingRef = useRef<ChordPending | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const clearPending = (): void => {
      pendingRef.current = null
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
      if (chordSnapshot) publishChord(null)
    }

    const runById = (id: string): void => {
      const command = commands.find((candidate) => candidate.id === id)
      if (command && command.enabled !== false) command.run()
    }

    const unsubscribe = bridge.on('command:invoke', ({ command }) => runById(command))

    const onKeyDown = (event: KeyboardEvent): void => {
      // A binding whose command is missing or disabled must not shadow another.
      const live: Record<string, string> = {}
      for (const [commandId, binding] of Object.entries(bindings)) {
        if (!binding) continue
        const command = commands.find((candidate) => candidate.id === commandId)
        if (!command || command.enabled === false) continue
        live[commandId] = binding
      }

      const result = resolveKeyInput(live, event, pendingRef.current, {
        modifiedOnly: isEditableTarget(event.target)
      })

      if (result.kind === 'ignored') return
      if (result.kind === 'idle') {
        clearPending()
        return
      }

      event.preventDefault()

      if (result.kind === 'pending') {
        pendingRef.current = result.pending
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(clearPending, CHORD_TIMEOUT_MS)
        publishChord({
          keys: [...result.pending.keys],
          candidates: result.candidates.map((candidate) => ({
            commandId: candidate.commandId,
            remaining: candidate.remaining,
            title: commands.find((one) => one.id === candidate.commandId)?.title ?? candidate.commandId
          }))
        })
        return
      }

      clearPending()
      runById(result.commandId)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [commands, bindings])
}

/** So no panel has to invent its own platform sniff. */
export function useIsMac(): boolean {
  const [isMac] = useState(detectIsMac)
  return isMac
}
