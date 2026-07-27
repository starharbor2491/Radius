import type { ModelInfo } from '@shared/types'
import { describeHttpError, readSse, safeJsonParse } from '../stream'
import { makeModel, splitSystem, type ChatParams, type DiscoverParams, type ProviderAdapter, type StreamPart } from './types'

const API_BASE = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

/**
 * Anthropic Messages API.
 *
 * Runs in the main process, so there is no CORS preflight and no need for the
 * browser-access opt-in header -- and, more importantly, the key never enters
 * a renderer.
 */
export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',

  defaultModels(): ModelInfo[] {
    // A starting point only. `discoverModels` replaces this with whatever the
    // account can actually see, which is the list that matters.
    const long = { contextWindow: 200_000, maxOutputTokens: 32_000 }
    return [
      makeModel('claude-opus-5', 'Claude Opus 5', {
        ...long,
        capabilities: { streaming: true, tools: true, vision: true, reasoning: true }
      }),
      makeModel('claude-sonnet-5', 'Claude Sonnet 5', {
        ...long,
        capabilities: { streaming: true, tools: true, vision: true, reasoning: true }
      }),
      makeModel('claude-fable-5', 'Claude Fable 5', {
        ...long,
        capabilities: { streaming: true, tools: true, vision: true, reasoning: true }
      }),
      makeModel('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', {
        contextWindow: 200_000,
        maxOutputTokens: 16_000,
        capabilities: { streaming: true, tools: true, vision: true, reasoning: false }
      })
    ]
  },

  async discoverModels({ apiKey }: DiscoverParams): Promise<ModelInfo[]> {
    if (!apiKey) return []
    const response = await fetch(`${API_BASE}/v1/models?limit=100`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION }
    })
    if (!response.ok) throw new Error(await describeHttpError(response))
    const body = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> }
    return (body.data ?? [])
      .filter((entry): entry is { id: string; display_name?: string } => typeof entry.id === 'string')
      .map((entry) =>
        makeModel(entry.id, entry.display_name ?? entry.id, {
          contextWindow: 200_000,
          maxOutputTokens: 32_000,
          capabilities: { streaming: true, tools: true, vision: true, reasoning: true }
        })
      )
  },

  async *stream(params: ChatParams): AsyncGenerator<StreamPart> {
    if (!params.apiKey) throw new Error('No Anthropic API key is configured.')
    const { system, rest } = splitSystem(params.messages)

    const response = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      signal: params.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': API_VERSION
      },
      body: JSON.stringify({
        model: params.modelId,
        max_tokens: params.maxOutputTokens,
        stream: true,
        ...(system ? { system } : {}),
        messages: rest.map((message) => ({ role: message.role, content: message.content }))
      })
    })

    if (!response.ok) throw new Error(await describeHttpError(response))
    if (!response.body) throw new Error('Anthropic returned an empty response body.')

    let inputTokens = 0
    let outputTokens = 0

    for await (const event of readSse(response.body, params.signal)) {
      const payload = safeJsonParse(event.data) as Record<string, unknown> | undefined
      if (!payload) continue

      switch (payload.type) {
        case 'message_start': {
          const usage = (payload.message as { usage?: { input_tokens?: number } } | undefined)?.usage
          inputTokens = usage?.input_tokens ?? 0
          break
        }
        case 'content_block_delta': {
          const delta = payload.delta as
            | { type?: string; text?: string; thinking?: string }
            | undefined
          if (delta?.type === 'text_delta' && delta.text) yield { text: delta.text }
          // Extended thinking arrives as its own delta type, before the answer.
          else if (delta?.type === 'thinking_delta' && delta.thinking) {
            yield { reasoning: delta.thinking }
          }
          break
        }
        case 'message_delta': {
          const usage = payload.usage as { output_tokens?: number } | undefined
          if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens
          break
        }
        case 'error': {
          const error = payload.error as { message?: string } | undefined
          throw new Error(error?.message ?? 'Anthropic stream error')
        }
        default:
          break
      }
    }

    yield { usage: { inputTokens, outputTokens } }
  }
}
