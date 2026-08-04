import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { normaliseForChatTemplate } from '../src/main/ai/messages'

let counter = 0
function message(role: ChatMessage['role'], content: string): ChatMessage {
  counter += 1
  return { id: `m${counter}`, role, content, createdAt: counter }
}

/** The rule the strict templates enforce, asserted directly. */
function alternates(messages: ChatMessage[]): boolean {
  const turns = messages.filter((entry) => entry.role !== 'system')
  return turns.every((entry, index) => entry.role === (index % 2 === 0 ? 'user' : 'assistant'))
}

describe('normaliseForChatTemplate', () => {
  it('merges consecutive user turns rather than sending two in a row', () => {
    const result = normaliseForChatTemplate([
      message('user', 'Task: find the pricing'),
      message('user', 'PAGE MAP: [1] Pricing link')
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe('Task: find the pricing\n\nPAGE MAP: [1] Pricing link')
  })

  it('merges consecutive assistant turns too', () => {
    const result = normaliseForChatTemplate([
      message('user', 'go'),
      message('assistant', 'one'),
      message('assistant', 'two')
    ])
    expect(result.map((entry) => entry.role)).toEqual(['user', 'assistant'])
    expect(result[1]!.content).toBe('one\n\ntwo')
  })

  /**
   * The exact shape the agent loop used to send, which LM Studio answered with
   * a 500 and "conversation roles must alternate user and assistant roles".
   */
  it('fixes the agent transcript that made LM Studio raise', () => {
    const before = [
      message('system', 'You drive a browser.'),
      message('user', 'Task: find the cheapest plan'),
      message('user', 'PAGE MAP step 0'),
      message('assistant', '{"kind":"click","index":3}'),
      message('user', 'Result: clicked Pricing'),
      message('user', 'PAGE MAP step 1'),
      message('assistant', '{"kind":"click","index":7}'),
      message('user', 'Result: clicked Compare'),
      message('user', 'PAGE MAP step 2')
    ]
    expect(alternates(before)).toBe(false)

    const after = normaliseForChatTemplate(before)
    expect(alternates(after)).toBe(true)
    expect(after[0]!.role).toBe('system')
    expect(after.map((entry) => entry.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user'
    ])
    // Nothing was thrown away, only joined.
    for (const original of before) {
      expect(after.some((entry) => entry.content.includes(original.content))).toBe(true)
    }
  })

  it('fixes a chat transcript where a turn failed and left no reply', () => {
    // The panel keeps the user's question in history when a request errors, so
    // the next question arrives as a second user turn.
    const after = normaliseForChatTemplate([
      message('user', 'what is this page'),
      message('user', 'are you there')
    ])
    expect(alternates(after)).toBe(true)
  })

  it('hoists and merges system messages to a single leading turn', () => {
    const after = normaliseForChatTemplate([
      message('system', 'first'),
      message('user', 'hello'),
      message('system', 'page context'),
      message('assistant', 'hi')
    ])
    expect(after[0]!.role).toBe('system')
    expect(after[0]!.content).toBe('first\n\npage context')
    expect(after.filter((entry) => entry.role === 'system')).toHaveLength(1)
    expect(alternates(after)).toBe(true)
  })

  it('drops a leading assistant turn, which has nothing to answer', () => {
    const after = normaliseForChatTemplate([
      message('assistant', 'unprompted'),
      message('user', 'hello')
    ])
    expect(after.map((entry) => entry.role)).toEqual(['user'])
  })

  it('drops empty messages instead of letting them break alternation', () => {
    const after = normaliseForChatTemplate([
      message('user', 'hello'),
      message('assistant', '   '),
      message('user', 'still there?')
    ])
    // Without dropping the blank, this would be user/assistant/user and look
    // fine -- but the blank assistant turn is a reply the model never made.
    expect(after).toHaveLength(1)
    expect(after[0]!.content).toBe('hello\n\nstill there?')
  })

  it('leaves an already-valid transcript alone', () => {
    const before = [
      message('system', 'be brief'),
      message('user', 'one'),
      message('assistant', 'two'),
      message('user', 'three')
    ]
    expect(normaliseForChatTemplate(before)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(normaliseForChatTemplate([])).toEqual([])
  })

  it('never emits two turns of the same role, whatever the input', () => {
    const roles: Array<ChatMessage['role']> = ['system', 'user', 'assistant']
    for (let seed = 0; seed < 200; seed += 1) {
      const length = seed % 9
      const input = Array.from({ length }, (_unused, index) =>
        message(roles[(seed * 7 + index * 3) % 3]!, `m${index}`)
      )
      const output = normaliseForChatTemplate(input)
      for (let index = 1; index < output.length; index += 1) {
        expect(output[index]!.role, JSON.stringify(output.map((e) => e.role))).not.toBe(
          output[index - 1]!.role
        )
      }
      expect(alternates(output)).toBe(true)
    }
  })
})
