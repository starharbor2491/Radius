import { describe, expect, it } from 'vitest'
import { readLines, readPath, readSse, safeJsonParse } from '@main/ai/stream'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of source) out.push(item)
  return out
}

describe('readLines', () => {
  it('reassembles lines split across chunk boundaries', async () => {
    const lines = await collect(readLines(streamOf('he', 'llo\nwor', 'ld\n')))
    expect(lines).toEqual(['hello', 'world'])
  })

  it('emits a trailing line with no newline', async () => {
    expect(await collect(readLines(streamOf('a\nb')))).toEqual(['a', 'b'])
  })

  it('strips carriage returns', async () => {
    expect(await collect(readLines(streamOf('a\r\nb\r\n')))).toEqual(['a', 'b'])
  })

  it('stops early when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await collect(readLines(streamOf('a\nb\n'), controller.signal))).toEqual([])
  })
})

describe('readSse', () => {
  it('groups data lines into events split by blank lines', async () => {
    const events = await collect(
      readSse(streamOf('event: delta\ndata: one\n\ndata: two\ndata: three\n\n'))
    )
    expect(events).toEqual([
      { event: 'delta', data: 'one' },
      { event: null, data: 'two\nthree' }
    ])
  })

  it('ignores comment/keep-alive lines', async () => {
    const events = await collect(readSse(streamOf(': ping\ndata: x\n\n')))
    expect(events).toEqual([{ event: null, data: 'x' }])
  })

  it('strips exactly one leading space after the colon', async () => {
    const events = await collect(readSse(streamOf('data:  padded\n\n')))
    expect(events[0]!.data).toBe(' padded')
  })

  it('flushes a final event with no trailing blank line', async () => {
    const events = await collect(readSse(streamOf('data: last\n')))
    expect(events).toEqual([{ event: null, data: 'last' }])
  })
})

describe('readPath', () => {
  const payload = { choices: [{ delta: { content: 'hi' } }], usage: { total: 3 } }

  it('walks objects and array indices', () => {
    expect(readPath(payload, 'choices.0.delta.content')).toBe('hi')
    expect(readPath(payload, 'usage.total')).toBe(3)
  })

  it('returns undefined for a missing path rather than throwing', () => {
    expect(readPath(payload, 'choices.9.delta.content')).toBeUndefined()
    expect(readPath(payload, 'nope.deeper')).toBeUndefined()
    expect(readPath(null, 'a.b')).toBeUndefined()
  })

  it('returns the whole value for an empty path', () => {
    expect(readPath(payload, '')).toBe(payload)
  })
})

describe('safeJsonParse', () => {
  it('returns undefined instead of throwing on malformed JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonParse('{oops')).toBeUndefined()
  })
})
