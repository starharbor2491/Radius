import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_PRESETS,
  MAX_CHORD_STEPS,
  analyseConflicts,
  bindingFromEvent,
  countOverrides,
  detectPreset,
  formatBinding,
  keybindingPreset,
  parseBinding,
  stepHasModifier,
  type KeybindingConflict
} from '@shared/keybindings'
import { bridge, send } from '../lib/bridge'
import { useIsMac } from '../lib/commands'
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
 * How long a half-captured chord waits before committing as a single key.
 *
 * Slightly longer than the dispatch timeout: recording deliberately is slower
 * than using something you already know.
 */
const CAPTURE_SETTLE_MS = 1400

interface Capture {
  commandId: string
  steps: string[]
}

/**
 * Remaps any command's shortcut, including chords.
 *
 * Capture works by listening for the next keydown while a row is armed, so a
 * user presses the combination they want rather than typing its name. A first
 * step that carries a modifier commits at once -- ⌘T is never the start of a
 * chord in practice -- while a bare key waits briefly to see whether a second
 * one follows, which is how `g` and `g t` are told apart without a mode switch.
 *
 * Clashes are flagged rather than blocked: sometimes you genuinely want to free
 * a key up before assigning it elsewhere. They are shown inline, on the rows
 * involved, because a warning at the bottom of a list of twenty-six rows does
 * not tell you which two are fighting.
 */
export function KeybindingsEditor(): JSX.Element {
  const [bindings, setBindings] = useState<Record<string, string>>(DEFAULT_KEYBINDINGS)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [capture, setCapture] = useState<Capture | null>(null)
  const isMac = useIsMac()
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  useEffect(() => {
    // Merge over the defaults rather than replacing them: a stored map only
    // holds what the user changed, so trusting it wholesale would show every
    // untouched command as unassigned.
    void Promise.all([
      bridge.invoke('keybindings:get', {}),
      bridge.invoke('keybindings:getPreset', {})
    ]).then(([stored, recorded]) => {
      const merged = { ...DEFAULT_KEYBINDINGS, ...stored }
      setBindings(merged)
      if (recorded.preset) {
        setPresetId(recorded.preset)
        return
      }
      /*
       * An installation from before preset sets existed has a map but no label
       * for it. Recording which set it matches is provenance, not a rewrite --
       * `keybindings:setPreset` deliberately leaves the map alone, so a user
       * who has edited on top keeps every edit.
       */
      const detected = detectPreset(merged)
      setPresetId(detected)
      if (detected) send('keybindings:setPreset', { preset: detected })
    })
  }, [])

  const write = (next: Record<string, string>, preset?: string): void => {
    setBindings(next)
    send('keybindings:set', preset ? { bindings: next, preset } : { bindings: next })
  }

  const commit = (commandId: string, steps: string[]): void => {
    setCapture(null)
    write({ ...bindingsRef.current, [commandId]: steps.join(' ') })
  }

  useEffect(() => {
    if (!capture) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setCapture(null)
        return
      }
      // Enter ends a chord early, so `g` on its own is one keypress plus Enter
      // rather than a wait.
      if (event.key === 'Enter' && capture.steps.length > 0) {
        commit(capture.commandId, capture.steps)
        return
      }

      const step = bindingFromEvent(event)
      if (!step) return

      const steps = [...capture.steps, step]
      const parsed = parseBinding(step)
      const finished =
        steps.length >= MAX_CHORD_STEPS || (steps.length === 1 && parsed && stepHasModifier(parsed))

      if (finished) commit(capture.commandId, steps)
      else setCapture({ commandId: capture.commandId, steps })
    }

    // Capture phase, so the shortcut being recorded does not also fire.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capture])

  // A bare first key that never gets a partner becomes a single-key binding.
  useEffect(() => {
    if (!capture || capture.steps.length === 0) return
    const timer = window.setTimeout(() => commit(capture.commandId, capture.steps), CAPTURE_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [capture])

  const conflicts = useMemo(() => analyseConflicts(bindings), [bindings])
  const conflictCount = useMemo(
    () => Object.values(conflicts).filter((list) => list.length > 0).length,
    [conflicts]
  )

  const overrides = presetId ? countOverrides(bindings, presetId) : 0
  const presetName = presetId ? (keybindingPreset(presetId)?.name ?? presetId) : null

  const applyPreset = (id: string): void => {
    const preset = keybindingPreset(id)
    if (!preset) return
    setCapture(null)
    setPresetId(id)
    write({ ...preset.bindings }, id)
  }

  return (
    <div className="rx-card">
      <div className="rx-row-between">
        <strong>Keyboard shortcuts</strong>
        <Button variant="outline" onClick={() => applyPreset('radius')}>
          Reset all
        </Button>
      </div>

      <div className="rx-keybind-sets">
        {KEYBINDING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="rx-keybind-set"
            data-active={preset.id === presetId ? 'true' : 'false'}
            title={preset.description}
            onClick={() => applyPreset(preset.id)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <span className="rx-keybind-note">
        {presetName
          ? overrides === 0
            ? `Using the ${presetName} set.`
            : `${presetName} set, with ${overrides} change${overrides === 1 ? '' : 's'} of your own.`
          : 'A set of your own. Applying one below replaces every shortcut.'}
      </span>

      <span className="rx-keybind-note">
        Press one key and pause for a single shortcut, or two in a row for a chord like G T.
      </span>

      {conflictCount > 0 ? (
        <span className="rx-danger">
          {conflictCount} shortcut{conflictCount === 1 ? '' : 's'} clash. See the rows below.
        </span>
      ) : null}

      {Object.entries(COMMAND_LABELS).map(([commandId, label]) => {
        const rowConflicts = conflicts[commandId] ?? []
        const capturing = capture?.commandId === commandId
        const binding = bindings[commandId]

        return (
          <div key={commandId} className="rx-keybind-row">
            <div className="rx-row-between">
              <span className={rowConflicts.length > 0 ? 'rx-danger' : undefined}>{label}</span>
              <span className="rx-keybind-controls">
                <button
                  type="button"
                  className="rx-keycap"
                  data-capturing={capturing ? 'true' : 'false'}
                  data-chord={binding && binding.includes(' ') ? 'true' : 'false'}
                  onClick={() => setCapture({ commandId, steps: [] })}
                >
                  {capturing
                    ? capture.steps.length === 0
                      ? 'Press keys…'
                      : `${formatBinding(capture.steps.join(' '), isMac)} …`
                    : binding
                      ? formatBinding(binding, isMac)
                      : 'Unassigned'}
                </button>
                <button
                  type="button"
                  className="rx-keycap-clear"
                  aria-label={`Clear shortcut for ${label}`}
                  title="Clear"
                  disabled={!binding && !capturing}
                  onClick={() => {
                    setCapture(null)
                    write({ ...bindings, [commandId]: '' })
                  }}
                >
                  ×
                </button>
              </span>
            </div>

            {rowConflicts.map((conflict, index) => (
              <span key={index} className="rx-keybind-conflict">
                {describeConflict(conflict, isMac)}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Says what kind of clash this is, because the two kinds have different fixes.
 * A duplicate means one of the two never runs; a shadow means the shorter of
 * the pair can never run, since the matcher has to wait to see whether the
 * longer one is coming.
 */
function describeConflict(conflict: KeybindingConflict, isMac: boolean): string {
  const other = COMMAND_LABELS[conflict.commandId] ?? conflict.commandId
  const keys = formatBinding(conflict.binding, isMac)
  if (conflict.kind === 'duplicate') return `Also assigned to ${other}.`
  if (conflict.kind === 'shadowed') return `Never fires: ${other} (${keys}) starts with it.`
  return `Shadows ${other} (${keys}), which can no longer fire.`
}
