import { forwardRef, useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useActiveWorkspace, useAppStore } from '../store/useAppStore'
import { SIDEBAR_MAX, SIDEBAR_MIN, useUiStore } from '../store/useUiStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'
import { Button, IconButton } from '../ui/primitives'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { TabStrip } from './TabStrip'
import { BookmarksPanel } from './BookmarksPanel'

/**
 * The left frame: workspace rail, tab strip, bookmarks, and a drag handle.
 *
 * The handle writes straight into the UI store; App turns the resulting width
 * into the chrome insets main uses to place the page view, so dragging this
 * edge really does resize the web page.
 *
 * The ref is forwarded to the real root element on purpose. App used to measure
 * a `display: contents` wrapper, which generates no box at all: the rect came
 * back as zeros, the left inset reached main as 0, and the page view was placed
 * over the top of the sidebar.
 */
export const Sidebar = forwardRef<HTMLDivElement>(function Sidebar(_props, forwardedRef): JSX.Element {
  const workspace = useActiveWorkspace()
  const workspaceCount = useAppStore((store) => store.state.workspaces.length)
  const bookmarkCount = useAppStore((store) => store.state.bookmarks.length)
  const tabCount = useAppStore(
    (store) => store.state.tabs.filter((tab) => tab.workspaceId === store.state.activeWorkspaceId).length
  )
  const { sidebarOpen, sidebarWidth, setSidebarWidth, bookmarksOpen, toggleBookmarks } = useUiStore()
  const { spring, when, amounts } = useMotionTokens()
  const { rubberBand } = amounts

  /*
   * Which way the workspaces moved, so the transition travels in the direction
   * the rail implies rather than always the same way. Ordering comes from the
   * rail itself, so clicking the workspace above always slides down and the one
   * below always slides up.
   */
  const workspaceIds = useAppStore((store) => store.state.workspaces.map((entry) => entry.id).join())
  const previousIndex = useRef(0)
  const index = workspaceIds.split(',').indexOf(workspace?.id ?? '')
  const direction = index === -1 || index === previousIndex.current ? 1 : index > previousIndex.current ? 1 : -1
  useEffect(() => {
    if (index !== -1) previousIndex.current = index
  }, [index])

  /*
   * True while a workspace switch is in flight. The strip animates as one
   * block during that window, so its rows stand down -- see the note on
   * `TabStrip`'s `settling` prop for the measurement that motivated it.
   */
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    setSettling(true)
    const timer = window.setTimeout(() => setSettling(false), 520)
    return () => window.clearTimeout(timer)
  }, [workspace?.id])

  const [dragging, setDragging] = useState(false)
  /** How far past a bound the handle is being pulled, in px. */
  const [overshoot, setOvershoot] = useState(0)

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(true)
      const startX = event.clientX
      const startWidth = sidebarWidth

      /*
       * Rubber band past the limits.
       *
       * Dragging beyond a bound used to feel like the pointer had come unstuck
       * from the handle: it kept moving and nothing did. The band goes on the
       * *handle*, not the width -- the sidebar genuinely cannot get wider, so
       * stretching it and snapping back would be a lie. Instead the handle
       * follows your hand with growing resistance and springs home on release,
       * which says "this is the edge" without pretending otherwise.
       *
       * At amplitude 0 it stops dead at the bound, which is what someone who
       * turned motion off is asking for.
       */
      const onMove = (moveEvent: PointerEvent): void => {
        const desired = startWidth + (moveEvent.clientX - startX)
        setSidebarWidth(desired)

        const over =
          desired < SIDEBAR_MIN
            ? desired - SIDEBAR_MIN
            : desired > SIDEBAR_MAX
              ? desired - SIDEBAR_MAX
              : 0
        // Square-root resistance: responsive at first, stiffer the further you
        // pull, and bounded rather than running away with the pointer.
        setOvershoot(Math.sign(over) * Math.sqrt(Math.abs(over)) * 6 * rubberBand)
      }
      const onUp = (): void => {
        setDragging(false)
        setOvershoot(0)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [sidebarWidth, setSidebarWidth, rubberBand]
  )

  return (
    <div
      className="rx-glass rx-sidebar"
      data-surface="chrome"
      data-radius-part="sidebar"
      ref={forwardedRef}
    >
      <div className="rx-rail" data-radius-part="workspace-rail">
        <div className="rx-rail-drag" />
        <WorkspaceSwitcher />
      </div>

      <AnimatePresence initial={false}>
        {sidebarOpen ? (
          <motion.div
            key="sidebar-body"
            className="rx-sidebar-body"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sidebarWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spring('panel')}
            style={{ overflow: 'hidden' }}
          >
            {/*
              The workspace name is editable in place, so it is a real input --
              but it should read as a heading until you click it, not as a form
              field sitting at the top of the sidebar.
            */}
            <div className="rx-sidebar-header">
              <input
                className="rx-workspace-name"
                value={workspace?.name ?? ''}
                placeholder="Workspace"
                aria-label="Workspace name"
                onChange={(event) => {
                  if (workspace) {
                    send('workspaces:update', { workspaceId: workspace.id, name: event.target.value })
                  }
                }}
              />
              <span className="rx-faint">{tabCount || ''}</span>
              <IconButton aria-label="New tab" title="New tab" onClick={() => send('tabs:create', {})}>
                <Icon name="plus" />
              </IconButton>
            </div>

            {/*
              Switching workspace should read as changing *place*, not as a list
              refreshing. The outgoing set leaves against the direction of
              travel and the incoming set arrives with it, at a slower, heavier
              spring than anything else in the chrome -- the `workspaceSwitch`
              token exists for exactly this and had never been used.

              `mode="popLayout"` so the two sets cross rather than the incoming
              one waiting for the outgoing one to finish.
            */}
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.div
                key={workspace?.id ?? 'none'}
                className="rx-workspace-slide"
                custom={direction}
                initial={when<Record<string, number> | false>({ opacity: 0, x: direction * 26 }, false)}
                animate={{ opacity: 1, x: 0 }}
                exit={when<Record<string, number>>({ opacity: 0, x: direction * -18 }, { opacity: 0 })}
                transition={spring('workspaceSwitch')}
              >
                <TabStrip settling={settling} />
              </motion.div>
            </AnimatePresence>

            {/*
              Bookmarks and workspace deletion both belong to the frame rather
              than to the tab list, so they sit below a rule. The destructive one
              is last and named, not a bare red icon beside a disclosure toggle.
            */}
            <div className="rx-sidebar-footer">
              <button
                type="button"
                className="rx-disclosure"
                aria-expanded={bookmarksOpen}
                onClick={toggleBookmarks}
              >
                <Icon name={bookmarksOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                <span className="rx-disclosure-label">Bookmarks</span>
                {bookmarkCount > 0 ? <span className="rx-faint">{bookmarkCount}</span> : null}
              </button>

              <BookmarksPanel open={bookmarksOpen} />

              {workspaceCount > 1 && workspace ? (
                <Button
                  variant="danger"
                  title={`Delete the "${workspace.name}" workspace and its tabs`}
                  onClick={() => send('workspaces:delete', { workspaceId: workspace.id })}
                >
                  <Icon name="trash" size={14} />
                  Delete workspace
                </Button>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {sidebarOpen ? (
        <motion.div
          className="rx-sidebar-resize"
          data-dragging={dragging ? 'true' : 'false'}
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          animate={{ x: overshoot }}
          transition={dragging ? { duration: 0 } : spring('press')}
        />
      ) : null}
    </div>
  )
})
