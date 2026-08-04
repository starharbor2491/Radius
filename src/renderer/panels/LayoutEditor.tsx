import { useMemo, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import {
  PANEL_NAMES,
  REGION_AXIS,
  REGION_BOUNDS,
  REGION_IDS,
  REGION_TITLES,
  isPanelOpen,
  parseLayout,
  type Layout,
  type PanelId,
  type RegionId
} from '@shared/layout'
import { useAppStore } from '../store/useAppStore'
import { useUiStore, useWorkspaceLayout } from '../store/useUiStore'
import { useMotionTokens } from '../lib/motion'
import { send } from '../lib/bridge'
import { Button, Field } from '../ui/primitives'

/** Where a saved arrangement lives. Settings are global; the layout is not. */
const PRESET_SETTING = 'layoutPreset'

/**
 * The keyboard-and-pointer-free half of the layout editor.
 *
 * Dragging a panel's header between docks is the fast path, but a drag is a
 * gesture nobody can discover from a screenshot and nobody can perform from a
 * keyboard. This section says the same thing in words: which panels are docked
 * where, how big each dock is, and two buttons to put it all back.
 *
 * Every control here sends the same IPC mutation the drag does. Nothing is
 * applied locally -- the layout arrives back as a snapshot, exactly like a tab
 * move.
 */
export function LayoutEditor(): JSX.Element {
  const layout = useWorkspaceLayout()
  const settings = useAppStore((store) => store.state.settings)
  const movePanel = useUiStore((store) => store.movePanel)
  const resizeRegion = useUiStore((store) => store.resizeRegion)
  const toggleRightPanel = useUiStore((store) => store.toggleRightPanel)
  const resetLayout = useUiStore((store) => store.resetLayout)
  const applyLayout = useUiStore((store) => store.applyLayout)
  const { spring } = useMotionTokens()

  const [note, setNote] = useState<string | null>(null)

  /**
   * The saved preset, if one parses. A stored document from an older build can
   * be missing regions, so it goes through the same parser as everything else
   * rather than being trusted because we wrote it.
   */
  const preset = useMemo<Layout | null>(() => {
    const stored = settings[PRESET_SETTING]
    return stored ? parseLayout(stored) : null
  }, [settings])

  return (
    <div className="rx-card">
      {REGION_IDS.map((region) => (
        <RegionRow
          key={region}
          region={region}
          layout={layout}
          onMove={movePanel}
          onResize={resizeRegion}
          onToggle={toggleRightPanel}
        />
      ))}

      <div className="rx-row">
        <Button
          variant="outline"
          onClick={() => {
            send('settings:set', { key: PRESET_SETTING, value: layout })
            setNote('Saved this arrangement as your layout preset.')
          }}
        >
          Save as preset
        </Button>
        <Button
          variant="outline"
          disabled={!preset}
          onClick={() => {
            if (!preset) return
            applyLayout(preset)
            setNote('Applied the saved preset to this workspace.')
          }}
        >
          Apply preset here
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            resetLayout()
            setNote('Layout reset to the default arrangement.')
          }}
        >
          Reset to default
        </Button>
      </div>

      {note ? (
        <motion.span
          className="rx-faint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={spring('panel')}
          style={{ fontSize: 'var(--rx-text-n1)' }}
        >
          {note}
        </motion.span>
      ) : (
        <span className="rx-faint" style={{ fontSize: 'var(--rx-text-n1)' }}>
          Drag a panel&rsquo;s title bar into another edge of the window to redock it. Escape cancels
          a drag. Every change is saved to this workspace.
        </span>
      )}
    </div>
  )
}

interface RegionRowProps {
  region: RegionId
  layout: Layout
  onMove: (panel: PanelId, region: RegionId) => void
  onResize: (region: RegionId, size: number) => void
  onToggle: (panel: PanelId) => void
}

function RegionRow({ region, layout, onMove, onResize, onToggle }: RegionRowProps): JSX.Element {
  const slice = layout.regions[region]
  const bounds = REGION_BOUNDS[region]

  return (
    <section className="rx-layout-region">
      <div className="rx-layout-region-head">
        <strong>{REGION_TITLES[region]}</strong>
        <span>
          {slice.panels.length} panel{slice.panels.length === 1 ? '' : 's'}
        </span>
      </div>

      <Field label={REGION_AXIS[region] === 'width' ? 'Width' : 'Height'}>
        <input
          className="rx-input rx-input-number"
          type="number"
          min={bounds.min}
          max={bounds.max}
          value={slice.size}
          onChange={(event) => onResize(region, Number.parseInt(event.target.value, 10))}
        />
      </Field>

      {slice.panels.length === 0 ? (
        <div className="rx-layout-empty">Nothing docked here yet.</div>
      ) : null}

      {slice.panels.map((panel) => (
        <div key={panel} className="rx-layout-panel" data-open={isPanelOpen(layout, panel) ? 'true' : 'false'}>
          <span className="rx-layout-panel-name">{PANEL_NAMES[panel]}</span>
          <div className="rx-row">
            {/* Ghost styling made these read as labels rather than the
                controls they are -- two words of plain text beside a select. */}
            <Button variant="outline" onClick={() => onToggle(panel)}>
              {slice.active === panel ? 'Hide' : 'Show'}
            </Button>
            <select
              className="rx-input"
              aria-label={`Dock ${PANEL_NAMES[panel]} in`}
              value={region}
              onChange={(event) => onMove(panel, event.target.value as RegionId)}
            >
              {REGION_IDS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {REGION_TITLES[candidate]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </section>
  )
}
