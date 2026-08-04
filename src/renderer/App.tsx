import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  PANEL_NAMES,
  PANEL_TITLES,
  REGION_AXIS,
  REGION_BOUNDS,
  REGION_IDS,
  REGION_TITLES,
  layoutSignature,
  type Layout,
  type PanelId,
  type RegionId
} from '@shared/layout'
import { useAppStore } from './store/useAppStore'
import { useUiStore, useWorkspaceLayout } from './store/useUiStore'
import { useIsMac } from './lib/commands'
import { useCommandDispatch, useCommands } from './lib/commands'
import { useMotionTokens } from './lib/motion'
import { send } from './lib/bridge'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { CommandPalette } from './components/CommandPalette'
import { FocusRing } from './ui/FocusRing'
import { FindBar } from './components/FindBar'
import { ChatPanel } from './panels/ChatPanel'
import { AgentPanel } from './panels/AgentPanel'
import { HistoryPanel } from './panels/HistoryPanel'
import { DownloadsPanel } from './panels/DownloadsPanel'
import { UsagePanel } from './panels/UsagePanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { ThemeStudio } from './panels/ThemeStudio'
import { Icon } from './ui/Icon'
import { IconButton, Toast } from './ui/primitives'
import { ChordIndicator } from './ui/ChordIndicator'

/** How far the pointer must travel before a header press becomes a drag. */
const DRAG_THRESHOLD = 5

/** The page never gets dragged smaller than this by a dock's resize handle. */
const MIN_VIEWPORT = 240

/**
 * The chrome shell.
 *
 * Nothing here decides where a panel goes any more: it renders whatever the
 * workspace's layout document says. Three things about the geometry are load
 * bearing and easy to break.
 *
 * 1. The page is a native `WebContentsView` stacked *above* this chrome, inset
 *    by the numbers `reportInsets` sends to main. A region that main is not
 *    told about is a region the page covers -- which is why the bottom dock's
 *    height is measured and reported, not assumed to be zero.
 * 2. Everything measured is a real box. A `display: contents` wrapper generates
 *    no box at all, so `getBoundingClientRect` returns zeros and the inset
 *    silently collapses. This shipped broken once for the sidebar.
 * 3. Region sizes animate, so the measurement has to keep going until the
 *    animation settles rather than being taken once on the change.
 */
export function App(): JSX.Element {
  const ready = useAppStore((store) => store.ready)
  const commands = useCommands()
  useCommandDispatch(commands)

  const layout = useWorkspaceLayout()
  const toast = useUiStore((store) => store.toast)
  const sidebarOpen = useUiStore((store) => store.sidebarOpen)
  const isMac = useIsMac()
  const signature = layoutSignature(layout)

  const sidebarRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  /**
   * Reports the chrome's footprint to main.
   *
   * Main is the only side that can move a WebContentsView, so this measurement
   * is the link between "the user docked a panel along the bottom" and "the page
   * got shorter". Measuring the real DOM rather than trusting the layout
   * document means animated sizes stay in sync mid-transition.
   */
  const reportInsets = useCallback(() => {
    const width = (ref: RefObject<HTMLDivElement | null>): number =>
      ref.current?.getBoundingClientRect().width ?? 0
    const height = (ref: RefObject<HTMLDivElement | null>): number =>
      ref.current?.getBoundingClientRect().height ?? 0

    send('chrome:setInsets', {
      top: height(toolbarRef),
      left: width(sidebarRef) + width(leftRef),
      right: width(rightRef),
      bottom: height(bottomRef)
    })
  }, [])

  useLayoutEffect(() => {
    reportInsets()
    const observer = new ResizeObserver(reportInsets)
    for (const node of [
      sidebarRef.current,
      toolbarRef.current,
      leftRef.current,
      rightRef.current,
      bottomRef.current
    ]) {
      if (node) observer.observe(node)
    }
    window.addEventListener('resize', reportInsets)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportInsets)
    }
    // `signature` rather than `layout`: a region that just appeared has to be
    // picked up by the observer, but a page title change must not tear it down.
  }, [reportInsets, signature])

  // A dock opening or closing animates its size, so keep reporting until it
  // settles. Without this the page view lands on the pre-animation geometry.
  useEffect(() => {
    const timer = window.setInterval(reportInsets, 60)
    const stop = window.setTimeout(() => window.clearInterval(timer), 700)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [signature, reportInsets])

  return (
    <div
      className="rx-shell"
      data-radius-part="shell"
      /*
       * macOS draws its own close/minimise/zoom buttons over the top-left of a
       * frameless window, and the chrome has to keep out from under them. Both
       * facts matter: which platform, and whether the sidebar is open -- with it
       * closed the toolbar becomes the leftmost thing and inherits the problem.
       */
      data-platform={isMac ? 'mac' : 'other'}
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
    >
      <Sidebar ref={sidebarRef} />

      <Dock region="left" layout={layout} hostRef={leftRef} />

      <div className="rx-main">
        <div ref={toolbarRef}>
          <Toolbar />
          <FindBar />
        </div>
        <div className="rx-viewport">{ready ? null : 'Starting Radius…'}</div>
        <Dock region="bottom" layout={layout} hostRef={bottomRef} />
      </div>

      <Dock region="right" layout={layout} hostRef={rightRef} />

      <DropZones layout={layout} />
      <CommandPalette commands={commands} />
      <Toast message={toast} />
      <FocusRing />
      <ChordIndicator />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * A dock region
 * ------------------------------------------------------------------ */

interface DockProps {
  region: RegionId
  layout: Layout
  hostRef: RefObject<HTMLDivElement | null>
}

/**
 * One dockable region.
 *
 * Renders nothing at all when the region has no active panel, which is how the
 * default layout reproduces the old chrome exactly: three regions declared, one
 * of them holding every panel, none of them showing anything until asked.
 */
function Dock({ region, layout, hostRef }: DockProps): JSX.Element {
  const active = layout.regions[region].active
  const size = layout.regions[region].size
  const axis = REGION_AXIS[region]
  const { spring } = useMotionTokens()

  const closeRegion = useUiStore((store) => store.closeRegion)
  const resizeRegion = useUiStore((store) => store.resizeRegion)
  const beginPanelDrag = useUiStore((store) => store.beginPanelDrag)
  const setDropRegion = useUiStore((store) => store.setDropRegion)
  const endPanelDrag = useUiStore((store) => store.endPanelDrag)
  const movePanel = useUiStore((store) => store.movePanel)

  const [resizing, setResizing] = useState(false)

  const collapsed = axis === 'width' ? { width: 0, opacity: 0 } : { height: 0, opacity: 0 }
  const expanded = axis === 'width' ? { width: size, opacity: 1 } : { height: size, opacity: 1 }

  /**
   * Drag the region's edge to resize it.
   *
   * Every move round-trips through main and comes back as a snapshot rather
   * than being applied locally: main has to know the new size anyway to inset
   * the page, and a local copy would be a second source of truth for the one
   * number both sides must agree on. Frames are coalesced so a fast drag sends
   * at most one mutation per repaint.
   */
  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setResizing(true)
      const start = axis === 'width' ? event.clientX : event.clientY
      const startSize = size
      // `left` grows as its right edge moves right; `right` and `bottom` grow as
      // their leading edge moves the other way.
      const direction = region === 'left' ? 1 : -1
      let frame = 0

      /*
       * How far this edge can travel before the page has nowhere left to go.
       * Measured from the viewport that is actually on screen rather than
       * computed from the document, because the sidebar and the other docks all
       * take a share and only the DOM knows what each of them ended up with.
       */
      const room = document.querySelector('.rx-viewport')?.getBoundingClientRect()
      const spare = (axis === 'width' ? (room?.width ?? 0) : (room?.height ?? 0)) - MIN_VIEWPORT
      const ceiling = startSize + Math.max(0, spare)

      const onMove = (moveEvent: PointerEvent): void => {
        const current = axis === 'width' ? moveEvent.clientX : moveEvent.clientY
        const next = Math.min(ceiling, startSize + direction * (current - start))
        if (frame) return
        frame = window.requestAnimationFrame(() => {
          frame = 0
          resizeRegion(region, next)
        })
      }
      const onUp = (): void => {
        if (frame) window.cancelAnimationFrame(frame)
        setResizing(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [axis, region, resizeRegion, size]
  )

  /**
   * Drag the panel's header to dock it somewhere else.
   *
   * The press only becomes a drag once the pointer has actually travelled, so a
   * click on the header still behaves like a click. Escape cancels mid-flight,
   * as does releasing anywhere that is not a drop target.
   */
  const startPanelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || event.button !== 0) return
      const panel = active
      const startX = event.clientX
      const startY = event.clientY
      let dragging = false

      const onMove = (moveEvent: PointerEvent): void => {
        const travelled = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY)
        if (!dragging && travelled < DRAG_THRESHOLD) return
        if (!dragging) {
          dragging = true
          beginPanelDrag(panel)
        }
        setDropRegion(regionAtPoint(moveEvent.clientX, moveEvent.clientY))
      }

      const finish = (apply: boolean): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('keydown', onKey, true)
        if (!dragging) return
        const target = useUiStore.getState().dropRegion
        endPanelDrag()
        if (apply && target && target !== region) movePanel(panel, target)
      }

      const onUp = (): void => finish(true)
      const onKey = (keyEvent: KeyboardEvent): void => {
        // Only swallow Escape once the press has actually become a drag --
        // holding the mouse on a header must not stop Escape closing a palette.
        if (keyEvent.key !== 'Escape' || !dragging) return
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        finish(false)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      // Capture phase, so cancelling a drag never also closes the palette.
      window.addEventListener('keydown', onKey, true)
    },
    [active, beginPanelDrag, endPanelDrag, movePanel, region, setDropRegion]
  )

  return (
    <AnimatePresence initial={false}>
      {active ? (
        <motion.div
          key={`dock-${region}`}
          ref={hostRef}
          className="rx-glass rx-dock"
          data-surface="chrome"
          data-region={region}
          initial={collapsed}
          animate={expanded}
          exit={collapsed}
          transition={spring('panel')}
        >
          <div
            className="rx-dock-resize"
            data-dragging={resizing ? 'true' : 'false'}
            onPointerDown={startResize}
            role="separator"
            aria-orientation={axis === 'width' ? 'vertical' : 'horizontal'}
          />
          <div
            className="rx-dock-body"
            data-radius-part="panel"
            style={axis === 'width' ? { width: size } : { height: size }}
          >
            {/*
              The title bar is the drag handle -- that is the idiom, and a
              separate glyph for it only added a second thing to aim at eight
              pixels from the resize handle. The grip appears on hover to say
              the row is draggable without sitting there permanently.
            */}
            <div className="rx-panel-header" data-radius-part="panel-header">
              <div
                className="rx-dock-grab"
                onPointerDown={startPanelDrag}
                title={`Drag to move ${PANEL_NAMES[active]} to another dock`}
              >
                <Icon className="rx-dock-grip" name="grip" size={12} />
                <span className="rx-panel-title" data-radius-part="panel-title">
                  {PANEL_TITLES[active]}
                </span>
              </div>
              <IconButton
                className="rx-panel-close"
                aria-label={`Close ${PANEL_NAMES[active]}`}
                title={`Close ${PANEL_NAMES[active]}`}
                onClick={() => closeRegion(region)}
              >
                <Icon name="close" size={14} />
              </IconButton>
            </div>

            <PanelBody panel={active} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function PanelBody({ panel }: { panel: PanelId }): JSX.Element | null {
  switch (panel) {
    case 'ai':
      return <ChatPanel />
    case 'agent':
      return <AgentPanel />
    case 'settings':
      return <SettingsPanel />
    case 'theme':
      return <ThemeStudio />
    case 'history':
      return <HistoryPanel />
    case 'downloads':
      return <DownloadsPanel />
    case 'usage':
      return <UsagePanel />
    default:
      return null
  }
}

/* ------------------------------------------------------------------ *
 * Drop targets
 * ------------------------------------------------------------------ */

/**
 * Which dock a point belongs to.
 *
 * Bands rather than the regions' own rectangles, because an empty dock has no
 * rectangle to aim at -- the left dock is zero pixels wide until something is
 * in it. The bottom band is tested first so the two corners resolve to it.
 */
function regionAtPoint(x: number, y: number): RegionId | null {
  const width = window.innerWidth
  const height = window.innerHeight
  if (y > height * 0.75) return 'bottom'
  if (x < width * 0.25) return 'left'
  if (x > width * 0.75) return 'right'
  return null
}

/**
 * The drop targets shown while a panel is in flight.
 *
 * These are only visible because `beginPanelDrag` puts the chrome into overlay
 * mode: the left and bottom targets sit over ground the page view owns, and the
 * chrome paints underneath it the rest of the time.
 */
function DropZones({ layout }: { layout: Layout }): JSX.Element | null {
  const dragPanel = useUiStore((store) => store.dragPanel)
  const dropRegion = useUiStore((store) => store.dropRegion)
  const { spring, tween } = useMotionTokens()

  return (
    <AnimatePresence>
      {dragPanel ? (
        <motion.div
          className="rx-drop-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tween('fast')}
        >
          {REGION_IDS.map((region) => {
            const axis = REGION_AXIS[region]
            const size = Math.max(layout.regions[region].size, REGION_BOUNDS[region].min)
            return (
              <motion.div
                key={region}
                className="rx-drop-zone"
                data-region={region}
                data-active={dropRegion === region ? 'true' : 'false'}
                style={axis === 'width' ? { width: size } : { height: size }}
                initial={{ opacity: 0 }}
                animate={{ opacity: dropRegion === region ? 1 : 0.45 }}
                transition={spring('panel')}
              >
                <span className="rx-drop-label">
                  {REGION_TITLES[region]}
                  {dropRegion === region ? ` · ${PANEL_NAMES[dragPanel]}` : ''}
                </span>
              </motion.div>
            )
          })}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
