import { forwardRef, useCallback, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useActiveWorkspace, useAppStore } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
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
  const { sidebarOpen, sidebarWidth, setSidebarWidth, bookmarksOpen, toggleBookmarks } = useUiStore()
  const { spring } = useMotionTokens()

  const [dragging, setDragging] = useState(false)

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(true)
      const startX = event.clientX
      const startWidth = sidebarWidth

      const onMove = (moveEvent: PointerEvent): void => {
        setSidebarWidth(startWidth + (moveEvent.clientX - startX))
      }
      const onUp = (): void => {
        setDragging(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [sidebarWidth, setSidebarWidth]
  )

  return (
    <div
      className="rx-glass rx-sidebar"
      data-surface="chrome"
      ref={forwardedRef}
      style={{ borderRadius: 0, borderLeft: 'none', borderTop: 'none', borderBottom: 'none' }}
    >
      <div className="rx-rail">
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
            <div className="rx-row-between" style={{ paddingInline: 'var(--rx-space-1)' }}>
              <input
                className="rx-input"
                style={{ border: 'none', background: 'transparent', fontWeight: 'var(--rx-weight-medium)', paddingInline: 0 }}
                value={workspace?.name ?? ''}
                placeholder="Workspace"
                onChange={(event) => {
                  if (workspace) {
                    send('workspaces:update', { workspaceId: workspace.id, name: event.target.value })
                  }
                }}
              />
              <IconButton
                aria-label="New tab"
                title="New tab  ⌘T"
                onClick={() => send('tabs:create', {})}
              >
                <Icon name="plus" />
              </IconButton>
            </div>

            <TabStrip />

            <BookmarksPanel open={bookmarksOpen} />

            <div className="rx-row" style={{ flex: 'none', gap: 'var(--rx-space-1)' }}>
              <Button onClick={toggleBookmarks}>
                <Icon name={bookmarksOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                Bookmarks
              </Button>
              {workspaceCount > 1 && workspace ? (
                <Button
                  variant="danger"
                  title="Delete this workspace"
                  onClick={() => send('workspaces:delete', { workspaceId: workspace.id })}
                >
                  <Icon name="trash" />
                </Button>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {sidebarOpen ? (
        <div
          className="rx-sidebar-resize"
          data-dragging={dragging ? 'true' : 'false'}
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
        />
      ) : null}
    </div>
  )
})
