import { describe, expect, it } from 'vitest'
import type { Tab, TabGroup } from '@shared/types'
import { buildStrip } from '@renderer/store/strip'

const tab = (id: string, order: number, overrides: Partial<Tab> = {}): Tab => ({
  id,
  workspaceId: 'w',
  groupId: null,
  url: `https://${id}.test`,
  title: id,
  faviconUrl: null,
  pinned: false,
  suspended: false,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  order,
  lastActiveAt: 0,
  inAiContext: false,
  ...overrides
})

const group = (id: string, order = 0): TabGroup => ({
  id,
  workspaceId: 'w',
  title: id,
  color: 'blue',
  collapsed: false,
  order
})

describe('buildStrip', () => {
  it('renders a flat list when nothing is grouped', () => {
    const sections = buildStrip([tab('a', 0), tab('b', 1)], [])
    expect(sections.map((section) => section.key)).toEqual(['a', 'b'])
    expect(sections.every((section) => section.kind === 'tab')).toBe(true)
  })

  it('hoists pinned tabs above everything else', () => {
    const sections = buildStrip([tab('a', 0), tab('b', 1, { pinned: true })], [])
    expect(sections.map((section) => section.key)).toEqual(['b', 'a'])
  })

  it('emits a group once, at the position of its first member', () => {
    const tabs = [
      tab('a', 0),
      tab('b', 1, { groupId: 'g1' }),
      tab('c', 2),
      tab('d', 3, { groupId: 'g1' })
    ]
    const sections = buildStrip(tabs, [group('g1')])
    expect(sections.map((section) => section.key)).toEqual(['a', 'g1', 'c'])

    const groupSection = sections.find((section) => section.kind === 'group')
    expect(groupSection?.tabs?.map((member) => member.id)).toEqual(['b', 'd'])
  })

  it('keeps a grouped tab visible when its group record is missing', () => {
    // Defensive: a dangling groupId must not make a tab disappear from the UI.
    const sections = buildStrip([tab('a', 0, { groupId: 'ghost' })], [])
    expect(sections.map((section) => section.key)).toEqual(['a'])
    expect(sections[0]!.kind).toBe('tab')
  })

  it('still lists a collapsed group section', () => {
    const sections = buildStrip(
      [tab('a', 0, { groupId: 'g1' })],
      [{ ...group('g1'), collapsed: true }]
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]!.kind).toBe('group')
    expect(sections[0]!.tabs).toHaveLength(1)
  })

  it('handles multiple groups in first-member order', () => {
    const tabs = [
      tab('a', 0, { groupId: 'g2' }),
      tab('b', 1, { groupId: 'g1' }),
      tab('c', 2, { groupId: 'g2' })
    ]
    const sections = buildStrip(tabs, [group('g1'), group('g2')])
    expect(sections.map((section) => section.key)).toEqual(['g2', 'g1'])
  })

  it('returns nothing for an empty workspace', () => {
    expect(buildStrip([], [])).toEqual([])
  })
})
