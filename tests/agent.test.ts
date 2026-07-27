import { describe, expect, it } from 'vitest'
import {
  AGENT_SYSTEM_PROMPT,
  MAX_AGENT_STEPS,
  formatPageMap,
  parseAgentAction,
  type AgentPageMap
} from '@shared/agent'

describe('parseAgentAction', () => {
  it('parses a bare action object', () => {
    expect(parseAgentAction('{"kind":"click","index":3}')).toEqual({ kind: 'click', index: 3 })
  })

  it('parses through a markdown fence', () => {
    const reply = '```json\n{"kind":"scroll","amount":1}\n```'
    expect(parseAgentAction(reply)).toEqual({ kind: 'scroll', amount: 1 })
  })

  it('parses an action buried in prose', () => {
    // Models add commentary no matter how firmly they are told not to.
    const reply = 'I will click the sign-in button.\n{"kind":"click","index":7}\nThat should do it.'
    expect(parseAgentAction(reply)).toEqual({ kind: 'click', index: 7 })
  })

  it('handles nested braces without truncating', () => {
    const reply = '{"kind":"type","text":"{\\"a\\":1}","index":2}'
    expect(parseAgentAction(reply)).toEqual({ kind: 'type', text: '{"a":1}', index: 2 })
  })

  it('accepts every action in the vocabulary', () => {
    const cases = [
      '{"kind":"click","index":0}',
      '{"kind":"type","text":"hi"}',
      '{"kind":"key","key":"Return"}',
      '{"kind":"scroll","amount":-1}',
      '{"kind":"wait","ms":500}',
      '{"kind":"done","summary":"found it"}'
    ]
    for (const reply of cases) expect(parseAgentAction(reply), reply).not.toBeNull()
  })

  it('rejects an unknown action rather than guessing', () => {
    expect(parseAgentAction('{"kind":"navigate","url":"https://evil.test"}')).toBeNull()
    expect(parseAgentAction('{"kind":"click"}')).toBeNull()
    expect(parseAgentAction('{"kind":"click","index":-1}')).toBeNull()
  })

  it('returns null for prose with no action at all', () => {
    expect(parseAgentAction('I am not sure what to do here.')).toBeNull()
    expect(parseAgentAction('')).toBeNull()
  })
})

describe('formatPageMap', () => {
  const map: AgentPageMap = {
    url: 'https://example.test/pricing',
    title: 'Pricing',
    scrollY: 200,
    scrollHeight: 3000,
    viewportHeight: 800,
    elements: [
      { index: 0, tag: 'button', role: '', label: 'Buy now', value: '', x: 10, y: 20, width: 80, height: 30 },
      { index: 1, tag: 'input', role: 'email', label: '', value: 'a@b.c', x: 10, y: 60, width: 200, height: 30 }
    ]
  }

  it('numbers elements so the model can reference them', () => {
    const text = formatPageMap(map)
    expect(text).toContain('[0] <button> Buy now')
    expect(text).toContain('[1] <input/email> a@b.c')
  })

  it('reports scroll position when the page is taller than the viewport', () => {
    expect(formatPageMap(map)).toContain('scrolled 200px of 2200px')
  })

  it('omits the scroll note when everything fits', () => {
    const short = { ...map, scrollHeight: 400, viewportHeight: 800 }
    expect(formatPageMap(short)).not.toContain('scrolled')
  })

  it('says so plainly when there is nothing to act on', () => {
    expect(formatPageMap({ ...map, elements: [] })).toContain('No interactive elements')
  })
})

describe('the agent system prompt', () => {
  it('tells the model to refuse credentials and checkout', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/password/i)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/checkout|payment/i)
  })

  it('documents every action the schema accepts', () => {
    for (const kind of ['click', 'type', 'key', 'scroll', 'wait', 'done']) {
      expect(AGENT_SYSTEM_PROMPT).toContain(`"kind":"${kind}"`)
    }
  })

  it('caps a run at a reviewable number of steps', () => {
    expect(MAX_AGENT_STEPS).toBeGreaterThan(3)
    expect(MAX_AGENT_STEPS).toBeLessThanOrEqual(25)
  })
})
