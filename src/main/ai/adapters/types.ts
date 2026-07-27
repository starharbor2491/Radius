import type { ChatMessage, ModelInfo, ProviderManifest, TokenUsage } from '@shared/types'

export interface ChatParams {
  modelId: string
  messages: ChatMessage[]
  apiKey: string | null
  baseUrl: string | null
  manifest: ProviderManifest | null
  maxOutputTokens: number
  signal: AbortSignal
}

export interface DiscoverParams {
  apiKey: string | null
  baseUrl: string | null
}

/** One increment of a streamed reply. Usage arrives on its own part, at the end. */
export interface StreamPart {
  text?: string
  usage?: TokenUsage
}

/**
 * The contract every provider tier implements.
 *
 * Tier 1 adapters are hand-written against a specific API. Tier 2 reuses the
 * OpenAI adapter against a user-supplied base URL. Tier 3 is a single adapter
 * driven entirely by a JSON manifest. All three land here, so the rest of the
 * app never learns which tier it is talking to.
 */
export interface ProviderAdapter {
  id: string
  label: string
  /** Models shipped as a starting point; discovery supersedes them when it works. */
  defaultModels(): ModelInfo[]
  /** Live model list from the provider, when the API exposes one. */
  discoverModels?(params: DiscoverParams): Promise<ModelInfo[]>
  stream(params: ChatParams): AsyncGenerator<StreamPart>
}

export function splitSystem(messages: ChatMessage[]): {
  system: string
  rest: ChatMessage[]
} {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
  return {
    system: systemParts.join('\n\n'),
    rest: messages.filter((m) => m.role !== 'system')
  }
}

export function makeModel(
  id: string,
  label: string,
  overrides: Partial<Omit<ModelInfo, 'id' | 'label'>> = {}
): ModelInfo {
  return {
    id,
    label,
    contextWindow: overrides.contextWindow ?? 128_000,
    maxOutputTokens: overrides.maxOutputTokens ?? 8_192,
    capabilities: {
      streaming: true,
      tools: false,
      vision: false,
      reasoning: false,
      ...overrides.capabilities
    },
    // Null rather than a guess: a wrong price is worse than no price in a
    // cost meter the user is going to trust.
    inputPricePerMTok: overrides.inputPricePerMTok ?? null,
    outputPricePerMTok: overrides.outputPricePerMTok ?? null
  }
}
