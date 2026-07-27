import type { Tab, TabGroup } from '@shared/types'

/**
 * A rendered row of the tab strip: either a standalone tab or a group with its
 * members.
 */
export interface StripSection {
  kind: 'tab' | 'group'
  key: string
  tab?: Tab
  group?: TabGroup
  tabs?: Tab[]
}

/**
 * Arranges a workspace's tabs into render order: pinned tabs first, then
 * ungrouped tabs and groups interleaved by the position of each group's
 * earliest member.
 *
 * Kept in its own module, free of any IPC or DOM import, so the ordering rules
 * can be tested directly.
 */
export function buildStrip(tabs: Tab[], groups: TabGroup[]): StripSection[] {
  const pinned = tabs.filter((tab) => tab.pinned)
  const rest = tabs.filter((tab) => !tab.pinned)

  const sections: StripSection[] = pinned.map((tab) => ({ kind: 'tab', key: tab.id, tab }))
  const emitted = new Set<string>()

  for (const tab of rest) {
    if (!tab.groupId) {
      sections.push({ kind: 'tab', key: tab.id, tab })
      continue
    }
    if (emitted.has(tab.groupId)) continue

    const group = groups.find((candidate) => candidate.id === tab.groupId)
    if (!group) {
      // A dangling groupId must not make the tab vanish from the sidebar.
      sections.push({ kind: 'tab', key: tab.id, tab })
      continue
    }

    emitted.add(tab.groupId)
    sections.push({
      kind: 'group',
      key: group.id,
      group,
      tabs: rest.filter((member) => member.groupId === group.id)
    })
  }

  return sections
}
