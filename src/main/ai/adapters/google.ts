import type { ModelInfo } from '@shared/types'
import { describeHttpError, readSse, safeJsonParse } from '../stream'
import { makeModel, splitSystem, type ChatParams, type DiscoverParams, type ProviderAdapter, type StreamPart } from './types'

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Google Generative Language API.
 *
 * Different enough from the OpenAI shape to need its own adapter: roles are
 * `user`/`model`, content is `parts`, the system prompt is a sibling field,
 * and streaming needs `?alt=sse` or the server replies with a JSON array.
 *
 * As with OpenAI, the model list comes from discovery rather than a hardcoded
 * catalogue -- `GET /v1beta/models` reports exactly what the key can reach.
 */
export const googleAdapter: ProviderAdapter = {
  id: 'google',
  label: 'Google Gemini',

  defaultModels(): ModelInfo[] {
    return []
  },

  async discoverModels({ apiKey, baseUrl }: DiscoverParams): Promise<ModelInfo[]> {
    if (!apiKey) return []
    const base = (baseUrl?.trim() || GOOGLE_BASE).replace(/\/+$/, '')
    const response = await fetch(`${base}/models?pageSize=200&key=${encodeURIComponent(apiKey)}`)
    if (!response.ok) throw new Error(await describeHttpError(response))
    const body = (await response.json()) as {
      models?: Array<{
        name?: string
        displayName?: string
        inputTokenLimit?: number
        outputTokenLimit?: number
        supportedGenerationMethods?: string[]
      }>
    }

    return (body.models ?? [])
      .filter((entry) => entry.supportedGenerationMethods?.includes('generateContent'))
      .map((entry) => {
        const id = (entry.name ?? '').replace(/^models\//, '')
        return makeModel(id, entry.displayName ?? id, {
          contextWindow: entry.inputTokenLimit ?? 128_000,
          maxOutputTokens: entry.outputTokenLimit ?? 8_192,
          capabilities: { streaming: true, tools: true, vision: true, reasoning: false }
        })
      })
      .filter((model) => model.id.length > 0)
  },

  async *stream(params: ChatParams): AsyncGenerator<StreamPart> {
    if (!params.apiKey) throw new Error('No Google API key is configured.')
    const base = (params.baseUrl?.trim() || GOOGLE_BASE).replace(/\/+$/, '')
    const { system, rest } = splitSystem(params.messages)
    const url =
      `${base}/models/${encodeURIComponent(params.modelId)}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(params.apiKey)}`

    const response = await fetch(url, {
      method: 'POST',
      signal: params.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: rest.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        generationConfig: { maxOutputTokens: params.maxOutputTokens }
      })
    })

    if (!response.ok) throw new Error(await describeHttpError(response))
    if (!response.body) throw new Error('Google returned an empty response body.')

    let usage: StreamPart['usage']

    for await (const event of readSse(response.body, params.signal)) {
      const payload = safeJsonParse(event.data) as
        | {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
            error?: { message?: string }
          }
        | undefined
      if (!payload) continue
      if (payload.error) throw new Error(payload.error.message ?? 'Google stream error')

      for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) yield { text: part.text }
      }
      if (payload.usageMetadata) {
        usage = {
          inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
          outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0
        }
      }
    }

    yield { usage: usage ?? { inputTokens: 0, outputTokens: 0 } }
  }
}
