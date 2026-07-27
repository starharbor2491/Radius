import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { schema } from '../db'
import type { StateStore } from '../state/StateStore'
import { SecretStore } from './SecretStore'
import type {
  AiStreamEvent,
  ChatMessage,
  ModelInfo,
  ProviderConfig,
  ProviderManifest,
  ProviderStatus,
  TokenUsage
} from '@shared/types'
import { ModelInfoSchema, ProviderManifestSchema } from '@shared/types'
import { anthropicAdapter } from './adapters/anthropic'
import { googleAdapter } from './adapters/google'
import { createOpenAiCompatibleAdapter, openAiAdapter } from './adapters/openai'
import { manifestAdapter } from './adapters/manifest'
import type { ProviderAdapter } from './adapters/types'
import { estimateCost } from './cost'

const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** Tier 1. Adding a vendor here is the only thing a first-class provider needs. */
const NATIVE_ADAPTERS: ProviderAdapter[] = [anthropicAdapter, openAiAdapter, googleAdapter]

type Emit = (event: AiStreamEvent) => void

/**
 * Owns every route to a model.
 *
 * The three tiers converge on one `ProviderAdapter` interface, so callers ask
 * for "provider X, model Y" and never learn whether that resolved to a
 * hand-written adapter, an OpenAI-compatible endpoint, or a user's JSON
 * manifest.
 */
export class ProviderRegistry {
  private readonly runs = new Map<string, AbortController>()

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretStore,
    private readonly state: StateStore
  ) {}

  /* ------------------------------------------------------------ seeding */

  seedBuiltIns(): void {
    const existing = new Set(
      this.db.select({ id: schema.providers.id }).from(schema.providers).all().map((row) => row.id)
    )
    NATIVE_ADAPTERS.forEach((adapter, index) => {
      if (existing.has(adapter.id)) return
      this.db
        .insert(schema.providers)
        .values({
          id: adapter.id,
          tier: 'native',
          label: adapter.label,
          adapter: adapter.id,
          baseUrl: null,
          manifest: null,
          models: adapter.defaultModels(),
          enabled: true,
          order: index
        })
        .run()
    })
  }

  /* -------------------------------------------------------------- reads */

  private rows(): ProviderConfig[] {
    return this.db
      .select()
      .from(schema.providers)
      .all()
      .map((row) => ({
        id: row.id,
        tier: row.tier as ProviderConfig['tier'],
        label: row.label,
        adapter: row.adapter,
        baseUrl: row.baseUrl,
        manifest: row.manifest ? ProviderManifestSchema.parse(row.manifest) : null,
        models: (row.models ?? []).flatMap((model) => {
          const parsed = ModelInfoSchema.safeParse(model)
          return parsed.success ? [parsed.data] : []
        }),
        enabled: row.enabled,
        order: row.order
      }))
      .sort((a, b) => a.order - b.order)
  }

  list(): ProviderStatus[] {
    return this.rows().map((config) => ({
      ...config,
      hasKey: this.secrets.has(SecretStore.keyFor(config.id))
    }))
  }

  get(providerId: string): ProviderConfig | undefined {
    return this.rows().find((config) => config.id === providerId)
  }

  /** Resolves the adapter that can actually talk to this provider. */
  private adapterFor(config: ProviderConfig): ProviderAdapter {
    switch (config.tier) {
      case 'native': {
        const found = NATIVE_ADAPTERS.find((adapter) => adapter.id === config.adapter)
        if (!found) throw new Error(`No built-in adapter named "${config.adapter}".`)
        return found
      }
      case 'openai-compatible':
        return createOpenAiCompatibleAdapter(config.id, config.label)
      case 'manifest':
        return manifestAdapter
    }
  }

  /* ------------------------------------------------------------ mutation */

  addOpenAiCompatible(input: { label: string; baseUrl: string; models: ModelInfo[] }): ProviderStatus {
    const id = randomUUID()
    this.db
      .insert(schema.providers)
      .values({
        id,
        tier: 'openai-compatible',
        label: input.label,
        adapter: null,
        baseUrl: input.baseUrl,
        manifest: null,
        models: input.models,
        enabled: true,
        order: this.rows().length
      })
      .run()
    return this.list().find((provider) => provider.id === id)!
  }

  addManifestProvider(input: {
    label: string
    manifest: ProviderManifest
    models: ModelInfo[]
  }): ProviderStatus {
    const id = randomUUID()
    this.db
      .insert(schema.providers)
      .values({
        id,
        tier: 'manifest',
        label: input.label,
        adapter: null,
        baseUrl: null,
        manifest: input.manifest,
        models: input.models,
        enabled: true,
        order: this.rows().length
      })
      .run()
    return this.list().find((provider) => provider.id === id)!
  }

  remove(providerId: string): void {
    this.db.delete(schema.providers).where(eq(schema.providers.id, providerId)).run()
    this.secrets.delete(SecretStore.keyFor(providerId))
  }

  setKey(providerId: string, key: string): void {
    this.secrets.set(SecretStore.keyFor(providerId), key)
  }

  clearKey(providerId: string): void {
    this.secrets.delete(SecretStore.keyFor(providerId))
  }

  private keyFor(config: ProviderConfig): string | null {
    return this.secrets.get(SecretStore.keyFor(config.id))
  }

  /* ----------------------------------------------------------- discovery */

  async discoverModels(providerId: string): Promise<ModelInfo[]> {
    const config = this.get(providerId)
    if (!config) throw new Error('Unknown provider.')
    const adapter = this.adapterFor(config)
    if (!adapter.discoverModels) return config.models

    const models = await adapter.discoverModels({
      apiKey: this.keyFor(config),
      baseUrl: config.baseUrl
    })
    if (models.length === 0) return config.models

    this.db.update(schema.providers).set({ models }).where(eq(schema.providers.id, providerId)).run()
    return models
  }

  /**
   * Cheapest possible round trip that proves the credentials work. Prefers
   * model discovery (a GET) and only falls back to a one-token completion for
   * providers that expose no model list.
   */
  async test(providerId: string, modelId?: string): Promise<{ ok: boolean; message: string }> {
    const config = this.get(providerId)
    if (!config) return { ok: false, message: 'Unknown provider.' }

    try {
      const adapter = this.adapterFor(config)
      if (adapter.discoverModels) {
        const models = await adapter.discoverModels({
          apiKey: this.keyFor(config),
          baseUrl: config.baseUrl
        })
        return { ok: true, message: `Connected. ${models.length} models available.` }
      }

      const target = modelId ?? config.models[0]?.id
      if (!target) return { ok: false, message: 'Add a model id before testing this provider.' }

      const controller = new AbortController()
      const stream = adapter.stream({
        modelId: target,
        messages: [{ id: 'probe', role: 'user', content: 'ping', createdAt: Date.now() }],
        apiKey: this.keyFor(config),
        baseUrl: config.baseUrl,
        manifest: config.manifest,
        maxOutputTokens: 1,
        signal: controller.signal
      })
      await stream.next()
      controller.abort()
      return { ok: true, message: 'Connected.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /* -------------------------------------------------------------- stream */

  /**
   * Runs a completion, pushing `delta` events as tokens land and exactly one
   * terminal `done` or `error`. Never throws: a failed run is reported through
   * the same channel the tokens use, so the UI has one path to handle.
   */
  async run(
    input: {
      runId: string
      providerId: string
      modelId: string
      messages: ChatMessage[]
      feature: string
    },
    emit: Emit
  ): Promise<void> {
    const { runId } = input
    const controller = new AbortController()
    this.runs.set(runId, controller)

    try {
      const config = this.get(input.providerId)
      if (!config) throw new Error('Unknown provider.')
      if (!config.enabled) throw new Error(`${config.label} is disabled.`)

      const adapter = this.adapterFor(config)
      const model = config.models.find((entry) => entry.id === input.modelId)

      let usage: TokenUsage | null = null
      for await (const part of adapter.stream({
        modelId: input.modelId,
        messages: input.messages,
        apiKey: this.keyFor(config),
        baseUrl: config.baseUrl,
        manifest: config.manifest,
        maxOutputTokens: model?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        signal: controller.signal
      })) {
        if (controller.signal.aborted) break
        if (part.text) emit({ runId, type: 'delta', text: part.text })
        if (part.usage) usage = part.usage
      }

      if (usage) {
        this.state.recordUsage({
          providerId: config.id,
          modelId: input.modelId,
          feature: input.feature,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: estimateCost(model, usage)
        })
      }
      emit({ runId, type: 'done', usage })
    } catch (error) {
      // An abort is a user action, not a failure -- close the run quietly.
      if (controller.signal.aborted) {
        emit({ runId, type: 'done', usage: null })
      } else {
        emit({
          runId,
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      this.runs.delete(runId)
    }
  }

  cancel(runId: string): void {
    this.runs.get(runId)?.abort()
    this.runs.delete(runId)
  }

  cancelAll(): void {
    for (const controller of this.runs.values()) controller.abort()
    this.runs.clear()
  }
}

export { estimateCost }
