import type { JSX } from 'react'
import { motion } from 'motion/react'
import { useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'

const WORKSPACE_ICONS = ['◎', '◈', '◐', '❖', '✦', '▲', '■', '●']

/**
 * The vertical rail of workspaces.
 *
 * Each chip carries its workspace's accent so switching reads as a change of
 * *place*, not just a change of tab list -- the accent then propagates through
 * the whole chrome via the theme override in ThemeProvider.
 *
 * Right-clicking a chip used to delete the workspace and every tab in it,
 * immediately and with no confirmation. That is a stray click away from losing
 * a day's work, and nothing on screen said it would happen. Deleting a
 * workspace now lives in the sidebar footer, named, and only for the one you
 * are looking at.
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
          data-radius-part="workspace-chip"
          data-active={workspace.id === activeId ? 'true' : 'false'}
          style={{ ['--rx-workspace-accent' as string]: workspace.accent }}
          title={workspace.name}
          aria-label={`Switch to ${workspace.name}`}
          aria-current={workspace.id === activeId}
          onClick={() => send('workspaces:activate', { workspaceId: workspace.id })}
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
        data-radius-part="workspace-chip"
        data-new="true"
        title="New workspace"
        aria-label="New workspace"
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
        <Icon name="plus" size={16} />
      </motion.button>
    </>
  )
}
