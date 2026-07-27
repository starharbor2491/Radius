import type { ModelInfo } from '@shared/types'
import { describeHttpError, readSse, safeJsonParse } from '../stream'
import { makeModel, type ChatParams, type DiscoverParams, type ProviderAdapter, type StreamPart } from './types'

const OPENAI_BASE = 'https://api.openai.com/v1'

/**
 * The OpenAI chat-completions shape.
 *
 * This single adapter serves both tiers 1 and 2: pointed at api.openai.com it
 * is the OpenAI provider, and pointed at any other base URL it drives Ollama,
 * LM Studio, vLLM, llama.cpp, Together, Groq, OpenRouter and the rest of the
 * long tail. That is why Radius does not need one hand-written adapter per
 * vendor.
 *
 * No default model catalogue is shipped: published model ids churn constantly
 * and a stale hardcoded list is worse than an empty one. `/v1/models` is
 * authoritative and every compatible server implements it.
 */
export function createOpenAiCompatibleAdapter(id: string, label: string): ProviderAdapter {
  return {
    id,
    label,

    defaultModels(): ModelInfo[] {
      return []
    },

    async discoverModels({ apiKey, baseUrl }: DiscoverParams): Promise<ModelInfo[]> {
      const base = normaliseBase(baseUrl)
      const response = await fetch(`${base}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
      })
      if (!response.ok) throw new Error(await describeHttpError(response))
      const body = (await response.json()) as { data?: Array<{ id?: string }> }
      return (body.data ?? [])
        .filter((entry): entry is { id: string } => typeof entry.id === 'string')
        .map((entry) => makeModel(entry.id, entry.id))
        .sort((a, b) => a.id.localeCompare(b.id))
    },

    async *stream(params: ChatParams): AsyncGenerator<StreamPart> {
      const base = normaliseBase(params.baseUrl)
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: params.signal,
        headers: {
          'content-type': 'application/json',
          // Local servers usually need no key at all; only send one if we have it.
          ...(params.apiKey ? { authorization: `Bearer ${params.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: params.modelId,
          stream: true,
          stream_options: { include_usage: true },
          messages: params.messages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        })
      })

      if (!response.ok) throw new Error(await describeHttpError(response))
      if (!response.body) throw new Error(`${label} returned an empty response body.`)

      let usage: StreamPart['usage']

      for await (const event of readSse(response.body, params.signal)) {
        if (event.data === '[DONE]') break
        const payload = safeJsonParse(event.data) as
          | {
              choices?: Array<{
                delta?: {
                  content?: string | null
                  reasoning_content?: string | null
                  reasoning?: string | null
                }
              }>
              usage?: { prompt_tokens?: number; completion_tokens?: number }
              error?: { message?: string }
            }
          | undefined
        if (!payload) continue
        if (payload.error) throw new Error(payload.error.message ?? `${label} stream error`)

        const delta = payload.choices?.[0]?.delta
        if (delta?.content) yield { text: delta.content }
        // No agreed field name for reasoning across OpenAI-compatible servers:
        // DeepSeek uses reasoning_content, others use reasoning.
        const reasoning = delta?.reasoning_content ?? delta?.reasoning
        if (reasoning) yield { reasoning }

        if (payload.usage) {
          usage = {
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0
          }
        }
      }

      yield { usage: usage ?? { inputTokens: 0, outputTokens: 0 } }
    }
  }
}

export const openAiAdapter = createOpenAiCompatibleAdapter('openai', 'OpenAI')

/** Tier 2 providers carry their own base URL; tier 1 OpenAI falls back to ours. */
function normaliseBase(baseUrl: string | null): string {
  const base = baseUrl?.trim() || OPENAI_BASE
  return base.replace(/\/+$/, '')
}
