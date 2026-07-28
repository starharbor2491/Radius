import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useAppStore } from './store/useAppStore'
import { useUiStore } from './store/useUiStore'
import { useCommandDispatch, useCommands } from './lib/commands'
import { useMotionTokens } from './lib/motion'
import { send } from './lib/bridge'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { CommandPalette } from './components/CommandPalette'
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

const PANEL_TITLES: Record<string, string> = {
  ai: 'Assistant',
  agent: 'Working alongside you',
  settings: 'Settings',
  theme: 'Theme studio',
  history: 'History',
  downloads: 'Downloads',
  usage: 'AI usage and budget'
}

export function App(): JSX.Element {
  const ready = useAppStore((store) => store.ready)
  const commands = useCommands()
  useCommandDispatch(commands)

  const { rightPanel, rightPanelWidth, setRightPanel, setRightPanelWidth, toast } = useUiStore()
  const { spring } = useMotionTokens()

  const sidebarRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelDragging, setPanelDragging] = useState(false)

  /**
   * Reports the chrome's footprint to main.
   *
   * Main is the only side that can move a WebContentsView, so this measurement
   * is the link between "the user dragged the sidebar" and "the page got
   * narrower". Measuring the real DOM rather than trusting the store means
   * animated widths stay in sync mid-transition.
   */
  const reportInsets = useCallback(() => {
    send('chrome:setInsets', {
      top: toolbarRef.current?.getBoundingClientRect().height ?? 0,
      left: sidebarRef.current?.getBoundingClientRect().width ?? 0,
      right: panelRef.current?.getBoundingClientRect().width ?? 0,
      bottom: 0
    })
  }, [])

  useLayoutEffect(() => {
    reportInsets()
    const observer = new ResizeObserver(reportInsets)
    for (const node of [sidebarRef.current, toolbarRef.current, panelRef.current]) {
      if (node) observer.observe(node)
    }
    window.addEventListener('resize', reportInsets)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportInsets)
    }
  }, [reportInsets, rightPanel])

  // Panel open/close animates its width, so keep reporting until it settles.
  useEffect(() => {
    const timer = window.setInterval(reportInsets, 60)
    const stop = window.setTimeout(() => window.clearInterval(timer), 700)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [rightPanel, reportInsets])

  const startPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setPanelDragging(true)
      const startX = event.clientX
      const startWidth = rightPanelWidth

      const onMove = (moveEvent: PointerEvent): void => {
        setRightPanelWidth(startWidth - (moveEvent.clientX - startX))
      }
      const onUp = (): void => {
        setPanelDragging(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [rightPanelWidth, setRightPanelWidth]
  )

  return (
    <div className="rx-shell">
      <Sidebar ref={sidebarRef} />

      <div className="rx-main">
        <div ref={toolbarRef}>
          <Toolbar />
          <FindBar />
        </div>
        <div className="rx-viewport">{ready ? null : 'Starting Radius…'}</div>
      </div>

      <AnimatePresence initial={false}>
        {rightPanel !== 'none' ? (
          <motion.div
            key="right-panel"
            ref={panelRef}
            className="rx-glass rx-right-panel"
            data-surface="chrome"
            style={{ borderRadius: 0, borderRight: 'none', borderTop: 'none', borderBottom: 'none' }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: rightPanelWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spring('panel')}
          >
            <div
              className="rx-sidebar-resize"
              data-dragging={panelDragging ? 'true' : 'false'}
              onPointerDown={startPanelResize}
              role="separator"
              aria-orientation="vertical"
            />
            <div className="rx-right-panel-body" style={{ width: rightPanelWidth - 6 }}>
              <div className="rx-panel-header">
                <span className="rx-panel-title">{PANEL_TITLES[rightPanel] ?? ''}</span>
                <IconButton aria-label="Close panel" onClick={() => setRightPanel('none')}>
                  <Icon name="close" size={13} />
                </IconButton>
              </div>

              {rightPanel === 'ai' ? <ChatPanel /> : null}
              {rightPanel === 'agent' ? <AgentPanel /> : null}
              {rightPanel === 'settings' ? <SettingsPanel /> : null}
              {rightPanel === 'theme' ? <ThemeStudio /> : null}
              {rightPanel === 'history' ? <HistoryPanel /> : null}
              {rightPanel === 'downloads' ? <DownloadsPanel /> : null}
              {rightPanel === 'usage' ? <UsagePanel /> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CommandPalette commands={commands} />
      <Toast message={toast} />
    </div>
  )
}
