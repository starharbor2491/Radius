import { useEffect, useMemo, useState } from 'react'
import type { Tab } from '@shared/types'
import { DEFAULT_KEYBINDINGS, matchesBinding } from '@shared/keybindings'
import { QUICK_ACTIONS } from '@shared/quick-actions'
import { bridge, send } from './bridge'
import { useActiveTab, useAppStore } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { useTheme } from '../theme/ThemeProvider'

export interface Command {
  id: string
  title: string
  shortcut?: string
  enabled?: boolean
  run: () => void
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
  const { theme, presets, applyPreset, update } = useTheme()

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
      { id: 'tab.new', title: 'New tab', shortcut: '⌘T', run: () => send('tabs:create', {}) },
      {
        id: 'tab.close',
        title: 'Close tab',
        shortcut: '⌘W',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:close', { tabId: tab.id }))
      },
      {
        id: 'tab.reopen',
        title: 'Reopen closed tab',
        shortcut: '⌘⇧T',
        run: () => send('tabs:reopenClosed', {})
      },
      {
        id: 'tab.reload',
        title: 'Reload page',
        shortcut: '⌘R',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:reload', { tabId: tab.id }))
      },
      {
        id: 'tab.pin',
        title: activeTab?.pinned ? 'Unpin tab' : 'Pin tab',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:setPinned', { tabId: tab.id, pinned: !tab.pinned }))
      },
      {
        id: 'tab.suspend',
        title: 'Suspend tab',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('tabs:suspend', { tabId: tab.id }))
      },
      {
        id: 'tab.aiContext',
        title: activeTab?.inAiContext ? 'Remove tab from AI context' : 'Add tab to AI context',
        enabled: Boolean(activeTab),
        run: withTab((tab) =>
          send('tabs:setAiContext', { tabId: tab.id, inContext: !tab.inAiContext })
        )
      },
      {
        id: 'group.new',
        title: 'Group this tab',
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
        shortcut: '⌘⇧N',
        run: () => send('workspaces:create', { name: `Workspace ${workspaces.length + 1}`, icon: '◈' })
      },
      {
        id: 'bookmark.add',
        title: 'Bookmark this page',
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
        shortcut: '⌘L',
        run: () => window.dispatchEvent(new Event('radius:focus-omnibox'))
      },
      { id: 'palette.open', title: 'Command palette', shortcut: '⌘K', run: () => ui.setPaletteOpen(true) },
      { id: 'sidebar.toggle', title: 'Toggle sidebar', shortcut: '⌘B', run: ui.toggleSidebar },
      { id: 'bookmarks.toggle', title: 'Toggle bookmarks', run: ui.toggleBookmarks },
      { id: 'ai.toggle', title: 'Toggle AI panel', shortcut: '⌘J', run: () => ui.toggleRightPanel('ai') },
      {
        id: 'agent.toggle',
        title: 'Let the assistant drive this page',
        shortcut: '⌘⇧A',
        run: () => ui.toggleRightPanel('agent')
      },
      { id: 'theme.open', title: 'Theme studio', shortcut: '⌘⇧,', run: () => ui.toggleRightPanel('theme') },
      { id: 'settings.open', title: 'Settings', run: () => ui.toggleRightPanel('settings') },
      {
        id: 'theme.import',
        title: 'Import theme from file…',
        run: () => {
          void bridge.invoke('theme:importFile', {}).then((imported) => {
            if (imported) applyPreset(imported.id)
          })
        }
      },
      { id: 'theme.export', title: 'Export theme to file…', run: () => send('theme:exportFile', { theme }) },
      {
        id: 'motion.cycle',
        title: `Motion: ${theme.motion.enabled ? `${theme.motion.scale}×` : 'off'} — cycle preset`,
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
        shortcut: '⌘F',
        enabled: Boolean(activeTab),
        run: () => ui.setFindOpen(true)
      },
      {
        id: 'history.open',
        title: 'History',
        shortcut: '⌘Y',
        run: () => ui.toggleRightPanel('history')
      },
      {
        id: 'downloads.open',
        title: 'Downloads',
        shortcut: '⌘⇧J',
        run: () => ui.toggleRightPanel('downloads')
      },
      {
        id: 'zoom.in',
        title: 'Zoom in',
        shortcut: '⌘+',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('zoom:step', { tabId: tab.id, direction: 'in' }))
      },
      {
        id: 'zoom.out',
        title: 'Zoom out',
        shortcut: '⌘-',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('zoom:step', { tabId: tab.id, direction: 'out' }))
      },
      {
        id: 'zoom.reset',
        title: 'Reset zoom',
        shortcut: '⌘0',
        enabled: Boolean(activeTab),
        run: withTab((tab) => send('zoom:step', { tabId: tab.id, direction: 'reset' }))
      },
      {
        id: 'tab.next',
        title: 'Next tab',
        run: () => cycleTab(1)
      },
      {
        id: 'tab.previous',
        title: 'Previous tab',
        run: () => cycleTab(-1)
      },
      {
        id: 'workspace.next',
        title: 'Next workspace',
        run: () => cycleWorkspace(1)
      },
      {
        id: 'workspace.previous',
        title: 'Previous workspace',
        run: () => cycleWorkspace(-1)
      },
      {
        id: 'workspace.delete',
        title: 'Delete this workspace',
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
      enabled: Boolean(activeTab),
      run: () => {
        ui.setRightPanel('ai')
        window.dispatchEvent(new CustomEvent('radius:quick-action', { detail: action.id }))
      }
    }))

    return [...base, ...presetCommands, ...quickActionCommands]
  }, [activeTab, allTabs, workspaces, activeWorkspaceId, ui, theme, presets, applyPreset, update])

  return commands
}

/**
 * Wires menu accelerators and the user's own keybindings to the registry.
 *
 * Bindings are read from main rather than hardcoded, so remapping a shortcut in
 * Settings takes effect without a restart.
 */
export function useCommandDispatch(commands: Command[]): void {
  const [bindings, setBindings] = useState<Record<string, string>>(DEFAULT_KEYBINDINGS)

  useEffect(() => {
    void bridge.invoke('keybindings:get', {}).then(setBindings)
    // Settings writes bindings and pushes a snapshot; re-read on every change.
    return bridge.on('state:changed', (snapshot) => {
      const stored = snapshot.settings.keybindings
      if (stored && typeof stored === 'object') {
        setBindings({ ...DEFAULT_KEYBINDINGS, ...(stored as Record<string, string>) })
      }
    })
  }, [])

  useEffect(() => {
    const runById = (id: string): void => {
      const command = commands.find((candidate) => candidate.id === id)
      if (command && command.enabled !== false) command.run()
    }

    const unsubscribe = bridge.on('command:invoke', ({ command }) => runById(command))

    const onKeyDown = (event: KeyboardEvent): void => {
      for (const [commandId, binding] of Object.entries(bindings)) {
        if (!binding || !matchesBinding(binding, event)) continue
        const command = commands.find((candidate) => candidate.id === commandId)
        if (!command || command.enabled === false) continue
        event.preventDefault()
        command.run()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [commands, bindings])
}
