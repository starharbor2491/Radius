import { useEffect, useMemo } from 'react'
import type { Tab } from '@shared/types'
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
  const workspaces = useAppStore((store) => store.state.workspaces)
  const activeWorkspaceId = useAppStore((store) => store.state.activeWorkspaceId)
  const ui = useUiStore()
  const { theme, presets, applyPreset, update } = useTheme()

  const commands = useMemo<Command[]>(() => {
    const withTab = (fn: (tab: Tab) => void) => () => {
      if (activeTab) fn(activeTab)
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

    return [...base, ...presetCommands]
  }, [activeTab, workspaces.length, activeWorkspaceId, ui, theme, presets, applyPreset, update])

  return commands
}

/** Wires menu accelerators and in-window keys to the registry. */
export function useCommandDispatch(commands: Command[]): void {
  useEffect(() => {
    const runById = (id: string): void => {
      const command = commands.find((candidate) => candidate.id === id)
      if (command && command.enabled !== false) command.run()
    }

    const unsubscribe = bridge.on('command:invoke', ({ command }) => runById(command))

    // The native menu owns most accelerators, but it does not fire while focus
    // is inside the chrome's own inputs -- these two are worth handling here.
    const onKeyDown = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        runById('palette.open')
      } else if (meta && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        runById('omnibox.focus')
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [commands])
}
