import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { part, RADIUS_PARTS } from '@renderer/theme/parts'

/**
 * `data-radius-part` is a contract with people who have written user CSS, so it
 * is pinned the same way the preload's event allowlist is: by checking the two
 * places that have to agree.
 *
 * This reads source files rather than rendering React, which keeps `tests/`
 * free of a DOM -- and it is the check that actually matters, since a part that
 * is documented but never rendered is a promise nobody kept.
 */

const ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

const renderer = sourceFiles(join(ROOT, 'src', 'renderer'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

const architecture = readFileSync(join(ROOT, 'ARCHITECTURE.md'), 'utf8')

describe('the data-radius-part contract', () => {
  it('renders every part it declares', () => {
    const missing = RADIUS_PARTS.filter(
      (name) =>
        !renderer.includes(`data-radius-part="${name}"`) && !renderer.includes(`part('${name}')`)
    )
    expect(missing).toEqual([])
  })

  it('documents every part it renders', () => {
    const rendered = new Set(
      [...renderer.matchAll(/data-radius-part="([a-z-]+)"/g)].map((match) => match[1]!)
    )
    for (const name of [...renderer.matchAll(/\bpart\('([a-z-]+)'\)/g)].map((m) => m[1]!)) {
      rendered.add(name)
    }
    // Anything on screen has to be in the list, or user CSS is aiming at
    // something nobody promised to keep.
    expect([...rendered].filter((name) => !RADIUS_PARTS.includes(name as never)).sort()).toEqual([])
  })

  it('is written into ARCHITECTURE.md, one row per part', () => {
    const undocumented = RADIUS_PARTS.filter((name) => !architecture.includes(`\`${name}\``))
    expect(undocumented).toEqual([])
  })

  it('has no duplicates', () => {
    expect(new Set(RADIUS_PARTS).size).toBe(RADIUS_PARTS.length)
  })

  it('spreads onto an element as a single attribute', () => {
    expect(part('tab')).toEqual({ 'data-radius-part': 'tab' })
  })
})
