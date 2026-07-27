/**
 * Wire-format helpers shared by every provider adapter.
 *
 * Deliberately dependency-free: the three provider tiers all reduce to "POST
 * JSON, read a stream of lines", and owning that path is what lets a
 * user-supplied manifest work without shipping code for it.
 */

/** Yields decoded lines from a fetch body, tolerating chunk boundaries mid-line. */
export async function* readLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        yield line
        newlineIndex = buffer.indexOf('\n')
      }
    }
    if (buffer.length > 0) yield buffer
  } finally {
    // Releasing the lock lets an aborted request tear down promptly.
    reader.releaseLock()
  }
}

export interface SseEvent {
  event: string | null
  data: string
}

/** Parses text/event-stream framing: `event:` / `data:` pairs split by blank lines. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseEvent> {
  let event: string | null = null
  let data: string[] = []

  for await (const line of readLines(body, signal)) {
    if (line === '') {
      if (data.length > 0) yield { event, data: data.join('\n') }
      event = null
      data = []
      continue
    }
    if (line.startsWith(':')) continue // comment / keep-alive
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  if (data.length > 0) yield { event, data: data.join('\n') }
}

/** Reads a dotted path like `choices.0.delta.content` out of a parsed body. */
export function readPath(source: unknown, path: string): unknown {
  if (!path) return source
  let cursor: unknown = source
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined
    if (Array.isArray(cursor)) {
      const index = Number.parseInt(segment, 10)
      if (Number.isNaN(index)) return undefined
      cursor = cursor[index]
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return cursor
}

export function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

/** Turns a non-2xx response into an error message worth showing a user. */
export async function describeHttpError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  const parsed = safeJsonParse(text)
  const message =
    (readPath(parsed, 'error.message') as string | undefined) ??
    (readPath(parsed, 'message') as string | undefined) ??
    text.slice(0, 400)
  return `HTTP ${response.status} ${response.statusText}${message ? `: ${message}` : ''}`
}
