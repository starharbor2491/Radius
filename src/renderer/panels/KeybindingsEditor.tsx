import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  DEFAULT_KEYBINDINGS,
  bindingFromEvent,
  findConflicts,
  formatBinding
} from '@shared/keybindings'
import { bridge, send } from '../lib/bridge'
import { Button } from '../ui/primitives'

const COMMAND_LABELS: Record<string, string> = {
  'tab.new': 'New tab',
  'tab.close': 'Close tab',
  'tab.reopen': 'Reopen closed tab',
  'tab.reload': 'Reload page',
  'tab.pin': 'Pin / unpin tab',
  'tab.next': 'Next tab',
  'tab.previous': 'Previous tab',
  'omnibox.focus': 'Focus address bar',
  'palette.open': 'Command palette',
  'find.open': 'Find in page',
  'sidebar.toggle': 'Toggle sidebar',
  'ai.toggle': 'Toggle AI panel',
  'ai.summarize': 'Summarize page',
  'agent.toggle': 'Assistant drives the page',
  'history.open': 'History',
  'downloads.open': 'Downloads',
  'bookmark.add': 'Bookmark this page',
  'bookmarks.toggle': 'Toggle bookmarks',
  'workspace.new': 'New workspace',
  'workspace.next': 'Next workspace',
  'workspace.previous': 'Previous workspace',
  'theme.open': 'Theme studio',
  'settings.open': 'Settings',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.reset': 'Reset zoom'
}

/**
 * Remaps any command's shortcut.
 *
 * Capture works by listening for the next keydown while a row is armed, so a
 * user presses the combination they want rather than typing its name. Clashes
 * are flagged rather than blocked -- sometimes you genuinely want to free a key
 * up before assigning it elsewhere.
 */
export function KeybindingsEditor(): JSX.Element {
  const [bindings, setBindings] = useState<Record<string, string>>(DEFAULT_KEYBINDINGS)
  const [capturing, setCapturing] = useState<string | null>(null)
  const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

  useEffect(() => {
    // Merge over the defaults rather than replacing them: a stored map only
    // holds what the user changed, so trusting it wholesale would show every
    // untouched command as unassigned.
    void bridge
      .invoke('keybindings:get', {})
      .then((stored) => setBindings({ ...DEFAULT_KEYBINDINGS, ...stored }))
  }, [])

  useEffect(() => {
    if (!capturing) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setCapturing(null)
        return
      }
      const binding = bindingFromEvent(event)
      if (!binding) return

      const next = { ...bindings, [capturing]: binding }
      setBindings(next)
      setCapturing(null)
      send('keybindings:set', { bindings: next })
    }

    // Capture phase, so the shortcut being recorded does not also fire.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturing, bindings])

  const conflicts = useMemo(() => findConflicts(bindings), [bindings])

  const conflictedCommands = useMemo(() => {
    const flagged = new Set<string>()
    for (const commandIds of Object.values(conflicts)) {
      for (const commandId of commandIds) flagged.add(commandId)
    }
    return flagged
  }, [conflicts])

  const reset = (): void => {
    setBindings(DEFAULT_KEYBINDINGS)
    send('keybindings:set', { bindings: DEFAULT_KEYBINDINGS })
  }

  return (
    <div className="rx-card">
      <div className="rx-row-between">
        <strong>Keyboard shortcuts</strong>
        <Button variant="outline" onClick={reset}>
          Reset all
        </Button>
      </div>

      {Object.keys(conflicts).length > 0 ? (
        <span className="rx-danger">
          {Object.keys(conflicts).length} shortcut
          {Object.keys(conflicts).length === 1 ? '' : 's'} assigned twice.
        </span>
      ) : null}

      {Object.entries(COMMAND_LABELS).map(([commandId, label]) => (
        <div key={commandId} className="rx-row-between">
          <span className={conflictedCommands.has(commandId) ? 'rx-danger' : undefined}>{label}</span>
          <button
            type="button"
            className="rx-keycap"
            data-capturing={capturing === commandId ? 'true' : 'false'}
            onClick={() => setCapturing(commandId)}
          >
            {capturing === commandId
              ? 'Press keys…'
              : bindings[commandId]
                ? formatBinding(bindings[commandId]!, isMac)
                : 'Unassigned'}
          </button>
        </div>
      ))}
    </div>
  )
}
