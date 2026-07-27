import { useMemo } from 'react'
import { create } from 'zustand'
import type { AppState, Tab, TabGroup, Workspace } from '@shared/types'
import { bridge } from '../lib/bridge'

export { buildStrip, type StripSection } from './strip'

const EMPTY_STATE: AppState = {
  workspaces: [],
  activeWorkspaceId: null,
  groups: [],
  tabs: [],
  activeTabIdByWorkspace: {},
  bookmarks: [],
  bookmarkFolders: [],
  providers: [],
  settings: {}
}

interface AppStore {
  state: AppState
  ready: boolean
  setState: (state: AppState) => void
}

/**
 * A mirror of main's authoritative state.
 *
 * Nothing here is mutated locally -- every change goes out over IPC and comes
 * back as a snapshot. That costs a round trip on each interaction and buys a
 * UI that cannot drift from what the browser is actually doing.
 */
export const useAppStore = create<AppStore>((set) => ({
  state: EMPTY_STATE,
  ready: false,
  setState: (state) => set({ state, ready: true })
}))

export function connectAppStore(): () => void {
  const { setState } = useAppStore.getState()

  const unsubscribe = bridge.on('state:changed', (snapshot) => setState(snapshot))
  void bridge.invoke('state:get', {}).then(setState)

  return unsubscribe
}

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

export function useActiveWorkspace(): Workspace | undefined {
  return useAppStore((store) =>
    store.state.workspaces.find((workspace) => workspace.id === store.state.activeWorkspaceId)
  )
}

/*
 * Derived lists are built with useMemo over a *stable* slice rather than inside
 * the selector.
 *
 * A selector that filters or sorts returns a new array on every call, and
 * zustand v5 compares snapshots by identity -- so doing the work inline makes
 * useSyncExternalStore believe the store changed on every render and React
 * bails out with "maximum update depth exceeded". Selecting `state.tabs`
 * (which only changes when a new snapshot arrives) and deriving outside keeps
 * the identity stable.
 */
export function useWorkspaceTabs(): Tab[] {
  const tabs = useAppStore((store) => store.state.tabs)
  const workspaceId = useAppStore((store) => store.state.activeWorkspaceId)

  return useMemo(() => {
    if (!workspaceId) return EMPTY_TABS
    return tabs.filter((tab) => tab.workspaceId === workspaceId).sort((a, b) => a.order - b.order)
  }, [tabs, workspaceId])
}

export function useWorkspaceGroups(): TabGroup[] {
  const groups = useAppStore((store) => store.state.groups)
  const workspaceId = useAppStore((store) => store.state.activeWorkspaceId)

  return useMemo(() => {
    if (!workspaceId) return EMPTY_GROUPS
    return groups
      .filter((group) => group.workspaceId === workspaceId)
      .sort((a, b) => a.order - b.order)
  }, [groups, workspaceId])
}

export function useActiveTab(): Tab | undefined {
  return useAppStore((store) => {
    const workspaceId = store.state.activeWorkspaceId
    if (!workspaceId) return undefined
    const activeId = store.state.activeTabIdByWorkspace[workspaceId]
    return store.state.tabs.find((tab) => tab.id === activeId)
  })
}

// Stable empty references keep zustand's identity check from re-rendering the
// tab strip on every unrelated snapshot.
const EMPTY_TABS: Tab[] = []
const EMPTY_GROUPS: TabGroup[] = []
