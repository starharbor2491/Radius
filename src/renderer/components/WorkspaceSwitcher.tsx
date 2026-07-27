import type { JSX } from 'react'
import { motion } from 'motion/react'
import { useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'

const WORKSPACE_ICONS = ['◎', '◈', '◐', '❖', '✦', '▲', '■', '●']

/**
 * The vertical rail of workspaces.
 *
 * Each chip carries its workspace's accent so switching reads as a change of
 * *place*, not just a change of tab list -- the accent then propagates through
 * the whole chrome via the theme override in ThemeProvider.
 */
export function WorkspaceSwitcher(): JSX.Element {
  const workspaces = useAppStore((store) => store.state.workspaces)
  const activeId = useAppStore((store) => store.state.activeWorkspaceId)
  const { spring, when } = useMotionTokens()

  return (
    <>
      {workspaces.map((workspace) => (
        <motion.button
          key={workspace.id}
          type="button"
          className="rx-workspace-chip"
          data-active={workspace.id === activeId ? 'true' : 'false'}
          style={{ ['--rx-workspace-accent' as string]: workspace.accent }}
          title={workspace.name}
          onClick={() => send('workspaces:activate', { workspaceId: workspace.id })}
          onContextMenu={(event) => {
            event.preventDefault()
            if (workspaces.length > 1) send('workspaces:delete', { workspaceId: workspace.id })
          }}
          whileHover={when({ scale: 1.08 }, {})}
          whileTap={when({ scale: 0.94 }, {})}
          layout={when(true, false)}
          transition={spring('press')}
        >
          {workspace.icon}
        </motion.button>
      ))}

      <motion.button
        type="button"
        className="rx-workspace-chip"
        title="New workspace"
        onClick={() =>
          send('workspaces:create', {
            name: `Workspace ${workspaces.length + 1}`,
            icon: WORKSPACE_ICONS[workspaces.length % WORKSPACE_ICONS.length] ?? '◎'
          })
        }
        whileHover={when({ scale: 1.08, rotate: 90 }, {})}
        whileTap={when({ scale: 0.94 }, {})}
        transition={spring('press')}
      >
        +
      </motion.button>
    </>
  )
}
