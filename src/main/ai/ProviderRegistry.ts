import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../store/JsonStore'
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
import {
  messageOf,
  parseRoutingConfig,
  planChain,
  shouldFailOver,
  type RoutingCandidate,
  type RoutingConfig
} from '@shared/routing'
import {
  evaluateBudget,
  formatUsd,
  parseBudgetConfig,
  spendInWindow,
  startOfMonthMs,
  type BudgetConfig
} from '@shared/budget'
import { adapterIdFor, findCatalogEntry, seedableCatalogEntries } from '@shared/provider-catalog'
import { anthropicAdapter } from './adapters/anthropic'
import { googleAdapter } from './adapters/google'
import { createOpenAiCompatibleAdapter, openAiAdapter } from './adapters/openai'
import { manifestAdapter } from './adapters/manifest'
import type { ProviderAdapter } from './adapters/types'
import { estimateCost } from './cost'
import { normaliseForChatTemplate } from './messages'

const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** Settings keys the routing and budget documents persist under. */
export const ROUTING_SETTING = 'aiRouting'
export const BUDGET_SETTING = 'aiBudget'

/**
 * Catalogue providers the user removed.
 *
 * Seeding runs on every boot, so without this a removal would last until the
 * next launch and look like a bug.
 */
export const DISMISSED_SETTING = 'aiDismissedProviders'

/**
 * A candidate that cannot be attempted at all -- removed, disabled, or with no
 * such model. Distinct from a provider failure because the chain should step
 * past a stale entry rather than report it as the run's outcome.
 */
class CandidateUnavailableError extends Error {}

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
    private readonly store: JsonStore,
    private readonly secrets: SecretStore,
    private readonly state: StateStore
  ) {}

  private get records(): ProviderConfig[] {
    return this.store.data.providers as ProviderConfig[]
  }

  /* ------------------------------------------------------------ seeding */

  /**
   * Puts every reachable provider in the catalogue on the list, ready for a key.
   *
   * Previously this seeded only the three native adapters, and two of those ship
   * no default model list on purpose (model ids churn; discovery is the honest
   * source). The visible result was a browser advertising every provider that
   * offered exactly one: Anthropic. Seeding the catalogue means OpenAI, Gemini,
   * Grok, DeepSeek, OpenRouter, Fireworks, DeepInfra, Cerebras and the rest are
   * present from first launch -- each one key-away from usable rather than
   * setup-flow-away.
   *
   * Templated entries (Azure, Databricks) and blocked ones (Bedrock, Vertex) are
   * excluded because their endpoint is not knowable here; the directory collects
   * what they need and adds them explicitly.
   *
   * Seeding is additive and id-keyed, so it is safe on every boot: a provider the
   * user removed stays removed only until... it does not. See `seededCatalog`.
   */
  seedBuiltIns(): void {
    const existing = new Set(this.records.map((record) => record.id))
    // Providers the user deliberately removed must not come back on next boot.
    const dismissed = new Set(this.state.getSetting<string[]>(DISMISSED_SETTING, []))

    let order = this.records.length
    for (const entry of seedableCatalogEntries()) {
      if (existing.has(entry.id) || dismissed.has(entry.id)) continue

      const adapterId = adapterIdFor(entry)
      const adapter = adapterId
        ? NATIVE_ADAPTERS.find((candidate) => candidate.id === adapterId)
        : undefined

      this.records.push({
        id: entry.id,
        tier: adapter ? 'native' : 'openai-compatible',
        label: entry.label,
        adapter: adapter ? adapter.id : null,
        // A native adapter knows its own endpoint; the compatible tier is told.
        baseUrl: adapter ? null : entry.baseUrl,
        manifest: null,
        // Empty is the honest default. Discovery fills it the moment a key lands.
        models: adapter ? adapter.defaultModels() : [],
        enabled: true,
        order: order++
      })
    }
    this.store.touch()
  }

  /* -------------------------------------------------------------- reads */

  private rows(): ProviderConfig[] {
    return this.records
      .map((row) => ({
        ...row,
        manifest: row.manifest ? ProviderManifestSchema.parse(row.manifest) : null,
        // A model written by an older build may not match the current schema;
        // drop those rather than failing the whole provider list.
        models: (row.models ?? []).flatMap((model) => {
          const parsed = ModelInfoSchema.safeParse(model)
          return parsed.success ? [parsed.data] : []
        })
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
    this.records.push({
      id,
      tier: 'openai-compatible',
      label: input.label,
      adapter: null,
      baseUrl: input.baseUrl,
      manifest: null,
      models: input.models,
      enabled: true,
      order: this.records.length
    })
    this.store.touch()
    return this.list().find((provider) => provider.id === id)!
  }

  addManifestProvider(input: {
    label: string
    manifest: ProviderManifest
    models: ModelInfo[]
  }): ProviderStatus {
    const id = randomUUID()
    this.records.push({
      id,
      tier: 'manifest',
      label: input.label,
      adapter: null,
      baseUrl: null,
      manifest: input.manifest,
      models: input.models,
      enabled: true,
      order: this.records.length
    })
    this.store.touch()
    return this.list().find((provider) => provider.id === id)!
  }

  remove(providerId: string): void {
    const kept = this.records.filter((record) => record.id !== providerId)
    this.records.length = 0
    this.records.push(...kept)
    this.store.touch()
    this.secrets.delete(SecretStore.keyFor(providerId))

    // Remember it, or the next boot's seeding puts it straight back.
    if (findCatalogEntry(providerId)) {
      const dismissed = new Set(this.state.getSetting<string[]>(DISMISSED_SETTING, []))
      dismissed.add(providerId)
      this.state.setSetting(DISMISSED_SETTING, [...dismissed])
    }
  }

  /**
   * Stores a key, then asks the provider what that key can see.
   *
   * Discovery is what turns a seeded row into a usable one, and doing it here
   * means pasting a key is the whole setup -- no second button to find. It runs
   * detached and swallows its error: a wrong key should surface on Test, not as
   * a failure of the save that plainly succeeded.
   */
  setKey(providerId: string, key: string): void {
    this.secrets.set(SecretStore.keyFor(providerId), key)
    void this.discoverModels(providerId).catch(() => undefined)
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

    const record = this.records.find((candidate) => candidate.id === providerId)
    if (record) record.models = models
    this.store.touch()
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

  /* ----------------------------------------------------- routing & budget */

  routing(): RoutingConfig {
    return parseRoutingConfig(this.state.getSetting<unknown>(ROUTING_SETTING, undefined))
  }

  setRouting(config: RoutingConfig): void {
    this.state.setSetting(ROUTING_SETTING, config)
  }

  budget(): BudgetConfig {
    return parseBudgetConfig(this.state.getSetting<unknown>(BUDGET_SETTING, undefined))
  }

  setBudget(config: BudgetConfig): void {
    this.state.setSetting(BUDGET_SETTING, config)
  }

  /** Tracked spend so far this calendar month, in USD. */
  monthlySpend(now = Date.now()): number {
    const since = startOfMonthMs(now)
    return spendInWindow(this.state.listUsage(since), since)
  }

  /* -------------------------------------------------------------- stream */

  /**
   * Runs a completion, pushing `delta` events as tokens land and exactly one
   * terminal `done` or `error`. Never throws: a failed run is reported through
   * the same channel the tokens use, so the UI has one path to handle.
   *
   * The run walks a routing chain (see `@shared/routing`). Three rules govern
   * moving down it:
   *
   * - Only failures `shouldFailOver` approves advance -- a rate limit or a
   *   server fault, not a rejected request.
   * - **Never after a token has been emitted.** A half-written answer must not
   *   get a second author; the user would read one paragraph from one model
   *   continued by another, with no seam to see.
   * - An abort ends the run wherever it is. Stop means stop, not "try the
   *   next one".
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
      const budget = this.budget()
      const spend = this.monthlySpend()
      const status = evaluateBudget(budget, spend)

      if (status === 'over' && budget.atLimit === 'block') {
        emit({
          runId,
          type: 'error',
          message:
            `Monthly AI budget reached: ${formatUsd(spend)} of ${formatUsd(budget.monthlyLimitUsd)} ` +
            `tracked spend this month, and the budget is set to block. Raise the limit or switch it ` +
            `to warn in Settings. (Models with no published pricing are not counted.)`
        })
        return
      }
      if (status === 'over') {
        emit({
          runId,
          type: 'notice',
          message:
            `Over the monthly budget: ${formatUsd(spend)} of ${formatUsd(budget.monthlyLimitUsd)} ` +
            `tracked spend. Continuing because the budget is set to warn.`
        })
      }

      const chain = planChain(this.routing(), input.feature, {
        providerId: input.providerId,
        modelId: input.modelId
      })

      let emitted = false
      let lastError: unknown = new Error('No provider was configured for this request.')

      for (let index = 0; index < chain.length; index += 1) {
        const candidate = chain[index]!
        const hasNext = index < chain.length - 1
        try {
          const usage = await this.attempt(candidate, input, controller, () => {
            emitted = true
          }, emit)
          emit({ runId, type: 'done', usage })
          return
        } catch (error) {
          // An abort is a user action, not a failure -- close the run quietly.
          if (controller.signal.aborted) {
            emit({ runId, type: 'done', usage: null })
            return
          }
          lastError = error

          const unavailable = error instanceof CandidateUnavailableError
          if (!emitted && hasNext && (unavailable || shouldFailOver(error))) {
            const next = chain[index + 1]!
            emit({
              runId,
              type: 'notice',
              message:
                `${this.describe(candidate)} did not answer (${messageOf(error) || 'unknown error'}). ` +
                `Falling back to ${this.describe(next)}.`
            })
            continue
          }
          throw error
        }
      }

      throw lastError
    } catch (error) {
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

  /**
   * One candidate's attempt. Streams deltas out through `emit` and returns the
   * usage it reported, or throws -- the caller decides whether to move on.
   */
  private async attempt(
    candidate: RoutingCandidate,
    input: { runId: string; messages: ChatMessage[]; feature: string },
    controller: AbortController,
    onFirstToken: () => void,
    emit: Emit
  ): Promise<TokenUsage | null> {
    const config = this.get(candidate.providerId)
    if (!config) throw new CandidateUnavailableError('Unknown provider.')
    if (!config.enabled) throw new CandidateUnavailableError(`${config.label} is disabled.`)

    const adapter = this.adapterFor(config)
    const model = config.models.find((entry) => entry.id === candidate.modelId)

    /*
     * Shaped here, at the last point before any adapter sees it, so every
     * caller and every tier gets the same treatment. A transcript that does not
     * alternate is a 500 from a Jinja-templated server with no clue which
     * message was at fault -- see `normaliseForChatTemplate`.
     */
    const messages = normaliseForChatTemplate(input.messages)

    let usage: TokenUsage | null = null
    for await (const part of adapter.stream({
      modelId: candidate.modelId,
      messages,
      apiKey: this.keyFor(config),
      baseUrl: config.baseUrl,
      manifest: config.manifest,
      maxOutputTokens: model?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      signal: controller.signal
    })) {
      if (controller.signal.aborted) break
      // Reasoning does not count as a first token: a model that thought aloud
      // and then failed can still be handed to the next provider in the chain,
      // because nothing of the answer has been shown yet.
      if (part.reasoning) {
        emit({ runId: input.runId, type: 'reasoning', text: part.reasoning })
      }
      if (part.text) {
        onFirstToken()
        emit({ runId: input.runId, type: 'delta', text: part.text })
      }
      if (part.usage) usage = part.usage
    }

    if (usage) {
      this.state.recordUsage({
        providerId: config.id,
        modelId: candidate.modelId,
        feature: input.feature,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: estimateCost(model, usage)
      })
    }
    return usage
  }

  /** Human-readable name for a chain entry, for the fallback notice. */
  private describe(candidate: RoutingCandidate): string {
    const config = this.get(candidate.providerId)
    const label = config?.label ?? candidate.providerId
    const model =
      config?.models.find((entry) => entry.id === candidate.modelId)?.label ?? candidate.modelId
    return `${label} · ${model}`
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
