import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import type { Tab, TabGroup } from '@shared/types'
import { TAB_GROUP_COLORS } from '@shared/types'
import { displayHost } from '@shared/url'
import { buildStrip, useActiveTab, useWorkspaceGroups, useWorkspaceTabs } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/primitives'

/** One draggable line in the strip, flattened from the nested group rendering. */
interface Row {
  tabId: string
  groupId: string | null
}

interface DropTarget {
  index: number
  groupId: string | null
}

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

/**
 * @param settling - True while the whole strip is being animated as one block,
 *   during a workspace switch. Individual rows then skip their own layout
 *   animation and entrance stagger: the strip is already moving, and animating
 *   twelve rows *inside* a moving container is both invisible and the single
 *   most expensive thing the chrome does. Measured at 183ms worst frame with
 *   it on, 100ms with it off.
 */
export function TabStrip({ settling = false }: { settling?: boolean } = {}): JSX.Element {
  const tabs = useWorkspaceTabs()
  const groups = useWorkspaceGroups()
  const activeTab = useActiveTab()
  const { spring, tween, stagger, when } = useMotionTokens()

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const rowNodes = useRef(new Map<string, HTMLElement>())

  const sections = useMemo(() => buildStrip(tabs, groups), [tabs, groups])

  // Flat order matches how StateStore renumbers a workspace (pinned first),
  // so a row index here is directly usable as `toIndex`.
  const rows = useMemo<Row[]>(() => {
    const flat: Row[] = []
    for (const section of sections) {
      if (section.kind === 'tab' && section.tab) {
        flat.push({ tabId: section.tab.id, groupId: null })
      } else if (section.group && section.tabs && !section.group.collapsed) {
        for (const tab of section.tabs) flat.push({ tabId: tab.id, groupId: section.group.id })
      } else if (section.group && section.tabs) {
        // Collapsed groups still occupy their members' slots in the order.
        for (const tab of section.tabs) flat.push({ tabId: tab.id, groupId: section.group.id })
      }
    }
    return flat
  }, [sections])

  const registerRow = useCallback((tabId: string, node: HTMLElement | null) => {
    if (node) rowNodes.current.set(tabId, node)
    else rowNodes.current.delete(tabId)
  }, [])

  /**
   * Resolves the pointer position to an insertion slot.
   *
   * Rows are measured live rather than cached because a group can collapse
   * mid-drag. The group of the row we land on is inherited, which is what makes
   * dragging a tab into or out of a group work without a separate gesture.
   */
  const resolveDropTarget = useCallback(
    (pointerY: number, draggedId: string): DropTarget => {
      let index = 0
      let groupId: string | null = null

      for (const [position, row] of rows.entries()) {
        const node = rowNodes.current.get(row.tabId)
        if (!node) continue
        const rect = node.getBoundingClientRect()
        const midpoint = rect.top + rect.height / 2
        if (pointerY > midpoint) {
          index = position + 1
          groupId = row.groupId
        } else {
          // Landing on the upper half of a row adopts that row's group.
          if (position === 0 || index === position) groupId = row.groupId
          break
        }
      }

      const draggedIndex = rows.findIndex((row) => row.tabId === draggedId)
      // Removing the dragged row first shifts every later slot up by one.
      if (draggedIndex !== -1 && index > draggedIndex) index -= 1
      return { index, groupId }
    },
    [rows]
  )

  const handleDrag = useCallback(
    (tabId: string, info: PanInfo) => {
      setDropTarget(resolveDropTarget(info.point.y, tabId))
    },
    [resolveDropTarget]
  )

  const handleDragEnd = useCallback(
    (tab: Tab) => {
      const target = dropTarget
      setDraggingId(null)
      setDropTarget(null)
      if (!target) return

      const currentIndex = rows.findIndex((row) => row.tabId === tab.id)
      if (currentIndex === target.index && (rows[currentIndex]?.groupId ?? null) === target.groupId) {
        return
      }
      send('tabs:move', { tabId: tab.id, toIndex: target.index, groupId: target.groupId })
    },
    [dropTarget, rows]
  )

  const renderTab = (tab: Tab, index: number, groupColorVar?: string): JSX.Element => (
    <TabItem
      key={tab.id}
      tab={tab}
      index={index}
      active={activeTab?.id === tab.id}
      dragging={draggingId === tab.id}
      groupColorVar={groupColorVar}
      register={registerRow}
      settling={settling}
      staggerDelay={settling ? 0 : stagger(index)}
      onDragStart={() => setDraggingId(tab.id)}
      onDrag={(info) => handleDrag(tab.id, info)}
      onDragEnd={() => handleDragEnd(tab)}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
      }}
    />
  )

  let cursor = 0

  return (
    <>
      <div className="rx-tabs" data-radius-part="tab-strip" ref={listRef} onScroll={() => setMenu(null)}>
        <AnimatePresence initial={false}>
          {sections.map((section) => {
            if (section.kind === 'tab' && section.tab) {
              return renderTab(section.tab, cursor++)
            }
            const group = section.group
            const members = section.tabs ?? []
            if (!group) return null
            const colorVar = `var(--rx-color-group-${group.color})`
            /*
             * Magnetic snap: while a drag is in flight, the group that would
             * capture it says so, and swells very slightly toward the pointer.
             * Dropping a tab into a group has no gesture of its own -- it is
             * inferred from where you let go -- so without this the difference
             * between "into the group" and "just past it" is invisible until
             * after you have committed.
             */
            const magnetised = Boolean(draggingId) && dropTarget?.groupId === group.id
            const block = (
              <motion.div
                key={group.id}
                layout={when(!settling, false)}
                className="rx-group"
                data-magnet={magnetised ? 'true' : 'false'}
                style={{ ['--rx-group-color' as string]: colorVar }}
                animate={when({ scale: magnetised ? 1.015 : 1 }, {})}
                transition={spring('panel')}
              >
                <GroupHeader group={group} count={members.length} />
                <AnimatePresence initial={false}>
                  {!group.collapsed &&
                    members.map((tab) => renderTab(tab, cursor++, colorVar))}
                </AnimatePresence>
              </motion.div>
            )
            if (group.collapsed) cursor += members.length
            return block
          })}
        </AnimatePresence>

        {dropTarget ? <DropIndicator target={dropTarget} rows={rows} nodes={rowNodes.current} listRef={listRef} /> : null}
      </div>

      <AnimatePresence>
        {menu ? (
          <TabContextMenu
            state={menu}
            tab={tabs.find((tab) => tab.id === menu.tabId)}
            groups={groups}
            transition={tween('fast')}
            onClose={() => setMenu(null)}
          />
        ) : null}
      </AnimatePresence>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Tab row
 * ------------------------------------------------------------------ */

interface TabItemProps {
  tab: Tab
  index: number
  active: boolean
  dragging: boolean
  groupColorVar?: string | undefined
  settling: boolean
  staggerDelay: number
  register: (tabId: string, node: HTMLElement | null) => void
  onDragStart: () => void
  onDrag: (info: PanInfo) => void
  onDragEnd: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

function TabItem({
  tab,
  active,
  dragging,
  groupColorVar,
  settling,
  staggerDelay,
  register,
  onDragStart,
  onDrag,
  onDragEnd,
  onContextMenu
}: TabItemProps): JSX.Element {
  const { spring, tween, when, amounts } = useMotionTokens()
  const [peeking, setPeeking] = useState(false)

  /*
   * A favicon that will not load falls back to the host initial through state,
   * never by taking the node out of the DOM.
   *
   * This used to be `onError={(event) => event.currentTarget.remove()}`, which
   * detaches a node React still believes it owns. The next render that replaced
   * the image -- the spinner going up on the *following* navigation -- called
   * `removeChild` on a node whose parent was already null, threw
   * `NotFoundError`, and unmounted the entire chrome. Two navigations in one
   * tab with an unloadable favicon was enough; `npm run smoke:app` only ever
   * navigated once, so nothing caught it.
   */
  const [faviconFailed, setFaviconFailed] = useState(false)
  useEffect(() => setFaviconFailed(false), [tab.faviconUrl])

  return (
    <motion.div
      ref={(node) => register(tab.id, node)}
      layout={when(!settling, false)}
      className="rx-tab"
      data-radius-part="tab"
      data-active={active ? 'true' : 'false'}
      data-suspended={tab.suspended ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      drag="y"
      dragSnapToOrigin
      dragElastic={0.08}
      dragMomentum={false}
      onDragStart={onDragStart}
      onDrag={(_event, info) => onDrag(info)}
      onDragEnd={onDragEnd}
      onPointerDown={() => send('tabs:activate', { tabId: tab.id })}
      onContextMenu={onContextMenu}
      onAuxClick={(event) => {
        // Middle click closes, as in every other browser.
        if (event.button === 1) send('tabs:close', { tabId: tab.id })
      }}
      initial={settling ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={settling ? undefined : { opacity: 0, x: -12, transition: tween('fast', 'exit') }}
      transition={{ ...spring('tabHover'), delay: staggerDelay }}
      // The lift distance is a token, so "everything lifts a bit less" is one
      // slider rather than a sweep through every hoverable component.
      whileHover={when({ x: 2, y: -amounts.lift }, {})}
      onHoverStart={() => setPeeking(true)}
      onHoverEnd={() => setPeeking(false)}
      title={tab.title || tab.url}
    >
      <span className="rx-tab-favicon" style={groupColorVar ? { color: groupColorVar } : undefined}>
        {tab.loading ? (
          <Spinner />
        ) : tab.faviconUrl && !faviconFailed ? (
          <img src={tab.faviconUrl} alt="" onError={() => setFaviconFailed(true)} />
        ) : (
          <span>{(displayHost(tab.url)[0] ?? '·').toUpperCase()}</span>
        )}
      </span>

      <span className="rx-tab-title">{tab.title || displayHost(tab.url) || 'New tab'}</span>

      {tab.pinned ? (
        <span className="rx-tab-pin">
          <Icon name="pin" size={12} />
        </span>
      ) : null}
      {tab.inAiContext ? (
        <span className="rx-tab-pin" title="In AI context">
          <Icon name="sparkle" size={12} />
        </span>
      ) : null}

      <TabPeek tab={tab} open={peeking && !dragging} />

      <button
        className="rx-tab-close"
        type="button"
        aria-label="Close tab"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          send('tabs:close', { tabId: tab.id })
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ *
 * Group header
 * ------------------------------------------------------------------ */

/** How long the pointer must rest on a tab before the preview appears. */
const PEEK_DELAY_MS = 420

/**
 * The hover preview: what that tab actually looks like.
 *
 * Two things make this honest rather than decorative. It waits — a preview that
 * fires the instant the pointer crosses a row turns a glance down the strip
 * into a strobe. And it only shows a picture if main actually has one: a tab
 * you have never left has never been photographed, so the card shows its title
 * and address and says so, rather than a grey rectangle pretending to be a
 * page.
 */
function TabPeek({ tab, open }: { tab: Tab; open: boolean }): JSX.Element | null {
  const { spring, enabled } = useMotionTokens()
  const [shown, setShown] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), PEEK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  // Fetch only once the card is actually going to be seen.
  useEffect(() => {
    if (!shown) return
    let live = true
    void bridge
      .invoke('tabs:thumbnail', { tabId: tab.id })
      .then((result) => {
        if (live) setThumb(result.dataUrl)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [shown, tab.id])

  return (
    <AnimatePresence>
      {shown ? (
        <motion.div
          className="rx-glass rx-peek"
          data-surface="popover"
          initial={{ opacity: 0, x: -8, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -6, scale: 0.98 }}
          transition={enabled ? spring('popover') : { duration: 0 }}
        >
          {thumb ? (
            <img className="rx-peek-shot" src={thumb} alt="" />
          ) : (
            <div className="rx-peek-blank">
              {tab.suspended ? 'Asleep — no preview yet' : 'No preview yet'}
            </div>
          )}
          <div className="rx-peek-meta">
            <span className="rx-peek-title">{tab.title || displayHost(tab.url) || 'New tab'}</span>
            <span className="rx-faint">{displayHost(tab.url)}</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function GroupHeader({ group, count }: { group: TabGroup; count: number }): JSX.Element {
  return (
    <div
      className="rx-group-header"
      data-collapsed={group.collapsed ? 'true' : 'false'}
      onClick={() => send('groups:update', { groupId: group.id, collapsed: !group.collapsed })}
      onContextMenu={(event) => {
        event.preventDefault()
        // Cycle the colour: the fastest possible way to recolour a group.
        const next =
          TAB_GROUP_COLORS[(TAB_GROUP_COLORS.indexOf(group.color) + 1) % TAB_GROUP_COLORS.length]
        if (next) send('groups:update', { groupId: group.id, color: next })
      }}
    >
      <span className="rx-group-caret">
        <Icon name="chevron-down" size={14} />
      </span>
      <span className="rx-tab-title">{group.title}</span>
      <span className="rx-faint">{count}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Drop indicator
 * ------------------------------------------------------------------ */

function DropIndicator({
  target,
  rows,
  nodes,
  listRef
}: {
  target: DropTarget
  rows: Row[]
  nodes: Map<string, HTMLElement>
  listRef: React.RefObject<HTMLDivElement | null>
}): JSX.Element | null {
  const list = listRef.current
  if (!list) return null

  const listRect = list.getBoundingClientRect()
  const anchorRow = rows[Math.min(target.index, rows.length - 1)]
  const anchorNode = anchorRow ? nodes.get(anchorRow.tabId) : undefined
  if (!anchorNode) return null

  const rect = anchorNode.getBoundingClientRect()
  const atEnd = target.index >= rows.length
  const top = (atEnd ? rect.bottom : rect.top) - listRect.top + list.scrollTop

  return (
    <div
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        top,
        height: 2,
        borderRadius: 2,
        background: 'var(--rx-color-accent)',
        boxShadow: '0 0 8px var(--rx-color-accent)',
        pointerEvents: 'none'
      }}
    />
  )
}

/* ------------------------------------------------------------------ *
 * Context menu
 * ------------------------------------------------------------------ */

function TabContextMenu({
  state,
  tab,
  groups,
  transition,
  onClose
}: {
  state: ContextMenuState
  tab: Tab | undefined
  groups: TabGroup[]
  transition: object
  onClose: () => void
}): JSX.Element | null {
  if (!tab) return null

  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 55 }}
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={transition}
        style={{ position: 'absolute', left: state.x, top: state.y, minWidth: 200, padding: 4 }}
        className="rx-glass"
        data-surface="popover"
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem
          label={tab.pinned ? 'Unpin tab' : 'Pin tab'}
          onClick={act(() => send('tabs:setPinned', { tabId: tab.id, pinned: !tab.pinned }))}
        />
        <MenuItem
          label={tab.inAiContext ? 'Remove from AI context' : 'Add to AI context'}
          onClick={act(() =>
            send('tabs:setAiContext', { tabId: tab.id, inContext: !tab.inAiContext })
          )}
        />
        <MenuItem
          label="New group from tab"
          onClick={act(() =>
            send('groups:create', {
              workspaceId: tab.workspaceId,
              title: 'New group',
              color: 'blue',
              tabIds: [tab.id]
            })
          )}
        />
        {groups.length > 0 && tab.groupId ? (
          <MenuItem
            label="Remove from group"
            onClick={act(() =>
              send('tabs:move', { tabId: tab.id, toIndex: tab.order, groupId: null })
            )}
          />
        ) : null}
        <MenuItem label="Suspend tab" onClick={act(() => send('tabs:suspend', { tabId: tab.id }))} />
        <MenuItem
          label="Close tab"
          danger
          onClick={act(() => send('tabs:close', { tabId: tab.id }))}
        />
      </motion.div>
    </div>
  )
}

function MenuItem({
  label,
  onClick,
  danger
}: {
  label: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className="rx-suggestion"
      style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left' }}
      onClick={onClick}
    >
      <span className={['rx-suggestion-label', danger ? 'rx-danger' : ''].join(' ')}>{label}</span>
    </button>
  )
}
