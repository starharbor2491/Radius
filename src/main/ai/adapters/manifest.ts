import type { ModelInfo, ProviderManifest } from '@shared/types'
import { describeHttpError, readLines, readPath, readSse, safeJsonParse } from '../stream'
import type { ChatParams, ProviderAdapter, StreamPart } from './types'

/**
 * Tier 3: a provider described entirely by JSON.
 *
 * This is what makes "every provider" tractable. Rather than shipping code for
 * each exotic API, the user describes where to POST, how to authenticate, which
 * body fields carry the model and messages, and where the text lives in the
 * response. The manifest is *data* -- validated by zod, interpreted here -- so
 * adding a provider never means executing third-party code.
 */
export const manifestAdapter: ProviderAdapter = {
  id: 'manifest',
  label: 'Custom provider',

  defaultModels(): ModelInfo[] {
    return []
  },

  async *stream(params: ChatParams): AsyncGenerator<StreamPart> {
    const manifest = params.manifest
    if (!manifest) throw new Error('This provider has no manifest configured.')

    const { url, headers } = applyAuth(manifest, params.apiKey)
    const body = {
      ...manifest.body,
      [manifest.modelField]: params.modelId,
      [manifest.messagesField]: params.messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      ...(manifest.streamFormat === 'none' ? {} : { stream: true })
    }

    const response = await fetch(url, {
      method: 'POST',
      signal: params.signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })

    if (!response.ok) throw new Error(await describeHttpError(response))

    if (manifest.streamFormat === 'none') {
      const payload = safeJsonParse(await response.text())
      const text = readPath(payload, manifest.textPath)
      if (typeof text === 'string' && text) yield { text }
      return
    }

    if (!response.body) throw new Error('Provider returned an empty response body.')

    const chunks =
      manifest.streamFormat === 'sse'
        ? sseData(response.body, params.signal, manifest.doneSentinel)
        : readLines(response.body, params.signal)

    for await (const chunk of chunks) {
      if (!chunk.trim()) continue
      const payload = safeJsonParse(chunk)
      if (payload === undefined) continue
      const delta = readPath(payload, manifest.deltaPath)
      if (typeof delta === 'string' && delta) yield { text: delta }
    }

    // No usage part is emitted on purpose: a manifest does not describe where
    // token counts live, so the cost meter shows "unknown" rather than a number
    // it cannot substantiate.
  }
}

async function* sseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  doneSentinel: string
): AsyncGenerator<string> {
  for await (const event of readSse(body, signal)) {
    if (doneSentinel && event.data === doneSentinel) return
    yield event.data
  }
}

/** Builds the authenticated URL and headers for a manifest request. */
export function applyAuth(
  manifest: ProviderManifest,
  apiKey: string | null
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { ...manifest.headers }
  let url = manifest.endpoint

  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider endpoints must use http or https.')
  }

  if (apiKey) {
    switch (manifest.authStyle) {
      case 'bearer':
        headers[manifest.authKey || 'Authorization'] = `Bearer ${apiKey}`
        break
      case 'x-api-key':
        headers[manifest.authKey || 'x-api-key'] = apiKey
        break
      case 'query-param': {
        parsed.searchParams.set(manifest.authKey || 'key', apiKey)
        url = parsed.toString()
        break
      }
      case 'none':
        break
    }
  }

  return { url, headers }
}
