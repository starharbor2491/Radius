/**
 * The directory of known AI providers.
 *
 * Radius could already reach all of these -- the OpenAI-compatible tier takes
 * any base URL. What was missing was *knowing the base URL*, which meant
 * "supports every provider" in practice required the user to go and find an
 * endpoint in someone's docs. This catalogue closes that gap: pick a name,
 * paste a key, done.
 *
 * Every base URL here is a starting point, not a constant. They are editable in
 * the UI and the Test button is what actually confirms one works, because
 * vendors move endpoints and this file will drift.
 */

export type CatalogKind =
  /** Reached through a hand-written adapter. */
  | 'native'
  /** Speaks the OpenAI chat-completions shape at a known base URL. */
  | 'openai-compatible'
  /** OpenAI-compatible, but the URL contains details only the user knows. */
  | 'templated'
  /** Cannot be reached with an API key alone; see `blockedReason`. */
  | 'blocked'

export interface CatalogPlaceholder {
  key: string
  label: string
  hint: string
}

export interface CatalogEntry {
  id: string
  label: string
  kind: CatalogKind
  /** Grouping for the directory UI. */
  category: 'frontier' | 'aggregator' | 'inference' | 'open' | 'local' | 'enterprise'
  /** Resolved endpoint, or null when `template` has to be filled in first. */
  baseUrl: string | null
  /** `{placeholder}` segments the user completes. */
  template?: string
  placeholders?: CatalogPlaceholder[]
  /** Where to get a key. Shown as a link rather than instructions to paraphrase. */
  apiKeyUrl?: string
  /** Local servers generally need no key at all. */
  requiresKey: boolean
  /** Why a `blocked` entry cannot work yet. */
  blockedReason?: string
  note?: string
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  /* ------------------------------------------------------------ frontier */
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'native',
    category: 'frontier',
    baseUrl: 'https://api.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'native',
    category: 'frontier',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'native',
    category: 'frontier',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    requiresKey: true
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyUrl: 'https://console.x.ai',
    requiresKey: true
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    requiresKey: true
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    requiresKey: true
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    requiresKey: true,
    note: 'Mainland China accounts use https://api.moonshot.cn/v1 instead.'
  },
  {
    id: 'zhipu',
    label: 'Zhipu (GLM)',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    requiresKey: true
  },
  {
    id: 'qwen',
    label: 'Alibaba Qwen (DashScope)',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.alibabacloud.com',
    requiresKey: true,
    note: 'Mainland China accounts use https://dashscope.aliyuncs.com/compatible-mode/v1.'
  },
  {
    id: 'cohere',
    label: 'Cohere',
    kind: 'openai-compatible',
    category: 'frontier',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    requiresKey: true
  },

  /* ---------------------------------------------------------- aggregator */
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    category: 'aggregator',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
    note: 'One key reaches most models from most vendors. A good default if you want breadth.'
  },
  {
    id: 'github-models',
    label: 'GitHub Models',
    kind: 'openai-compatible',
    category: 'aggregator',
    baseUrl: 'https://models.inference.ai.azure.com',
    apiKeyUrl: 'https://github.com/settings/tokens',
    requiresKey: true,
    note: 'Authenticates with a GitHub personal access token.'
  },
  {
    id: 'requesty',
    label: 'Requesty',
    kind: 'openai-compatible',
    category: 'aggregator',
    baseUrl: 'https://router.requesty.ai/v1',
    apiKeyUrl: 'https://app.requesty.ai',
    requiresKey: true
  },

  /* ----------------------------------------------------------- inference */
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    requiresKey: true
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    apiKeyUrl: 'https://deepinfra.com/dash/api_keys',
    requiresKey: true
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    requiresKey: true
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyUrl: 'https://fireworks.ai/account/api-keys',
    requiresKey: true
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyUrl: 'https://cloud.cerebras.ai',
    requiresKey: true
  },
  {
    id: 'sambanova',
    label: 'SambaNova',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.sambanova.ai/v1',
    apiKeyUrl: 'https://cloud.sambanova.ai/apis',
    requiresKey: true
  },
  {
    id: 'hyperbolic',
    label: 'Hyperbolic',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    apiKeyUrl: 'https://app.hyperbolic.xyz/settings',
    requiresKey: true
  },
  {
    id: 'nebius',
    label: 'Nebius AI Studio',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    apiKeyUrl: 'https://studio.nebius.ai',
    requiresKey: true
  },
  {
    id: 'novita',
    label: 'Novita AI',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.novita.ai/v3/openai',
    apiKeyUrl: 'https://novita.ai/settings/key-management',
    requiresKey: true
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    kind: 'openai-compatible',
    category: 'inference',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    requiresKey: true
  },

  /* -------------------------------------------------------------- local */
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai-compatible',
    category: 'local',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    note: 'Runs on your machine. Nothing leaves the device.'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai-compatible',
    category: 'local',
    baseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    note: 'Start the local server from LM Studio first.'
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    kind: 'openai-compatible',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    requiresKey: false
  },
  {
    id: 'vllm',
    label: 'vLLM',
    kind: 'openai-compatible',
    category: 'local',
    baseUrl: 'http://localhost:8000/v1',
    requiresKey: false
  },
  {
    id: 'jan',
    label: 'Jan',
    kind: 'openai-compatible',
    category: 'local',
    baseUrl: 'http://localhost:1337/v1',
    requiresKey: false
  },
  {
    id: 'localai',
    label: 'LocalAI',
    kind: 'openai-compatible',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    requiresKey: false
  },

  /* --------------------------------------------------------- enterprise */
  {
    id: 'databricks',
    label: 'Databricks',
    kind: 'templated',
    category: 'enterprise',
    baseUrl: null,
    template: 'https://{workspace}/serving-endpoints',
    placeholders: [
      {
        key: 'workspace',
        label: 'Workspace host',
        hint: 'e.g. dbc-a1b2c3d4-e5f6.cloud.databricks.com'
      }
    ],
    apiKeyUrl: 'https://docs.databricks.com/aws/en/dev-tools/auth/pat',
    requiresKey: true,
    note: 'Uses a personal access token. Model names are your serving-endpoint names.'
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    kind: 'templated',
    category: 'enterprise',
    baseUrl: null,
    template: 'https://{resource}.openai.azure.com/openai/v1',
    placeholders: [
      { key: 'resource', label: 'Resource name', hint: 'The name of your Azure OpenAI resource' }
    ],
    apiKeyUrl: 'https://portal.azure.com',
    requiresKey: true,
    note: 'Model names are your deployment names, not the underlying model ids.'
  },
  {
    id: 'openai-compatible-custom',
    label: 'Anything else (OpenAI-compatible)',
    kind: 'templated',
    category: 'enterprise',
    baseUrl: null,
    template: '{baseUrl}',
    placeholders: [
      { key: 'baseUrl', label: 'Base URL', hint: 'https://api.example.com/v1' }
    ],
    requiresKey: true,
    note: 'Any endpoint that speaks the OpenAI chat-completions shape.'
  },

  /* ------------------------------------------------------------ blocked */
  {
    id: 'bedrock',
    label: 'AWS Bedrock',
    kind: 'blocked',
    category: 'enterprise',
    baseUrl: null,
    requiresKey: true,
    blockedReason:
      'Bedrock signs every request with AWS SigV4 rather than a bearer token, which Radius does ' +
      'not implement yet. Reaching Bedrock models through OpenRouter works today.'
  },
  {
    id: 'vertex',
    label: 'Google Vertex AI',
    kind: 'blocked',
    category: 'enterprise',
    baseUrl: null,
    requiresKey: true,
    blockedReason:
      'Vertex authenticates with a short-lived OAuth token from a service account, not a static ' +
      'API key. Use the Gemini API entry above, which takes a plain key.'
  }
]

export const CATEGORY_LABELS: Record<CatalogEntry['category'], string> = {
  frontier: 'Model developers',
  aggregator: 'Aggregators — one key, many models',
  inference: 'Fast inference hosts',
  open: 'Open models',
  local: 'On your machine',
  enterprise: 'Enterprise and custom'
}

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === id)
}

/**
 * Substitutes placeholder values into an entry's template.
 *
 * Values are trimmed and any scheme the user pasted along with a hostname is
 * stripped, because people paste `https://host` into a field labelled "host"
 * constantly and a doubled scheme is an unhelpful failure.
 */
export function resolveBaseUrl(entry: CatalogEntry, values: Record<string, string>): string | null {
  if (entry.baseUrl) return entry.baseUrl
  if (!entry.template) return null

  let resolved = entry.template
  for (const placeholder of entry.placeholders ?? []) {
    const raw = (values[placeholder.key] ?? '').trim()
    if (!raw) return null
    const cleaned =
      placeholder.key === 'baseUrl' ? raw.replace(/\/+$/, '') : raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    resolved = resolved.replace(`{${placeholder.key}}`, cleaned)
  }

  return resolved.includes('{') ? null : resolved
}

/**
 * Which adapter a catalogue entry runs through, if any.
 *
 * `native` entries name a hand-written adapter; everything else with a fixed
 * base URL goes through the OpenAI-compatible one.
 */
export function adapterIdFor(entry: CatalogEntry): string | null {
  return entry.kind === 'native' ? entry.id : null
}

/**
 * The entries the registry seeds on first run.
 *
 * Every provider Radius can actually reach shows up in Settings from the
 * start, rather than only the three with hand-written adapters. Templated
 * entries are excluded because their URL is incomplete until the user fills it
 * in, and blocked ones because they cannot work at all yet.
 */
export function seedableCatalogEntries(): CatalogEntry[] {
  return PROVIDER_CATALOG.filter(
    (entry) => entry.baseUrl !== null && entry.kind !== 'blocked' && entry.kind !== 'templated'
  )
}

/** Catalogue entries grouped for display, preserving the declared order. */
export function catalogByCategory(): Array<[CatalogEntry['category'], CatalogEntry[]]> {
  const order: Array<CatalogEntry['category']> = [
    'frontier',
    'aggregator',
    'inference',
    'local',
    'enterprise',
    'open'
  ]
  return order
    .map((category) => [category, PROVIDER_CATALOG.filter((e) => e.category === category)] as const)
    .filter(([, entries]) => entries.length > 0)
    .map(([category, entries]) => [category, [...entries]])
}
