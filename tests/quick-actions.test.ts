import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { QUICK_ACTIONS, findQuickAction } from '@shared/quick-actions'

/**
 * Icon names are strings here because `quick-actions.ts` is shared with main,
 * which cannot import a React component. That loses the compiler's check, so
 * this reads the names the renderer actually ships and asserts against them.
 * A renamed or mistyped icon fails here instead of rendering an empty square.
 */
function shippedIconNames(): Set<string> {
  const source = readFileSync(resolve(__dirname, '../src/renderer/ui/Icon.tsx'), 'utf8')
  const body = source.slice(source.indexOf('const ICONS'), source.indexOf('satisfies Record'))
  const names = new Set<string>()
  for (const match of body.matchAll(/^\s{2}'?([a-z][a-z-]*)'?:/gm)) names.add(match[1]!)
  return names
}

describe('quick actions', () => {
  it('have unique ids', () => {
    const ids = QUICK_ACTIONS.map((action) => action.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('name an icon the renderer actually ships', () => {
    const shipped = shippedIconNames()
    // Guard against the scrape silently matching nothing.
    expect(shipped.size).toBeGreaterThan(20)
    for (const action of QUICK_ACTIONS) {
      expect(shipped.has(action.icon), `${action.id} -> ${action.icon}`).toBe(true)
    }
  })

  it('produce a non-empty prompt for their own context requirement', () => {
    for (const action of QUICK_ACTIONS) {
      const prompt = action.prompt({
        title: 'Example',
        url: 'https://example.com',
        selection: action.needs === 'selection' ? 'some selected text' : ''
      })
      expect(prompt.trim().length, action.id).toBeGreaterThan(20)
    }
  })

  it('mention the selection in a selection action, so the model has it', () => {
    for (const action of QUICK_ACTIONS.filter((candidate) => candidate.needs === 'selection')) {
      const prompt = action.prompt({ title: 't', url: 'u', selection: 'MARKER_TEXT' })
      expect(prompt.includes('MARKER_TEXT'), action.id).toBe(true)
    }
  })

  it('cover the whole workspace with at least one action', () => {
    expect(QUICK_ACTIONS.some((action) => action.needs === 'workspace')).toBe(true)
  })

  it('are findable by id', () => {
    expect(findQuickAction('summarize')?.label).toBe('Summarize page')
    expect(findQuickAction('nope')).toBeUndefined()
  })
})
