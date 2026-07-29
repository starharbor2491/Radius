import { useEffect, useMemo, useState, type JSX } from 'react'
import type { ProviderStatus } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { bridge } from '../lib/bridge'
import { Icon } from './Icon'
import { Button } from './primitives'

/**
 * Provider and model selection, shared by chat and the agent.
 *
 * The hard part is not the two dropdowns, it is what happens when a provider has
 * a key but no model list yet. Radius refuses to hardcode model ids -- they churn
 * weekly and a stale list is worse than none -- so a freshly keyed provider
 * legitimately knows nothing about its own models until discovery runs.
 *
 * The old picker filtered those providers out entirely, which is how a browser
 * that ships thirty providers ended up offering one. Here they stay selectable
 * and the model field degrades to a text box plus a Discover button, so the
 * worst case is typing a model id you already know rather than a dead end.
 */
export interface ModelSelection {
  providerId: string
  modelId: string
}

export interface ModelPickerProps extends ModelSelection {
  onChange: (selection: ModelSelection) => void
  disabled?: boolean
}

/**
 * Providers worth offering: enabled, and either already knowing some models or
 * holding a key that could discover them. A seeded provider with neither is real
 * but not yet reachable, and belongs in Settings rather than this dropdown.
 */
export function useSelectableProviders(): ProviderStatus[] {
  const providers = useAppStore((store) => store.state.providers)
  return useMemo(
    () =>
      providers.filter(
        (provider) => provider.enabled && (provider.hasKey || provider.models.length > 0)
      ),
    [providers]
  )
}

export function ModelPicker({
  providerId,
  modelId,
  onChange,
  disabled = false
}: ModelPickerProps): JSX.Element {
  const providers = useSelectableProviders()
  const provider = providers.find((candidate) => candidate.id === providerId)

  const [discovering, setDiscovering] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Settle on a default as soon as anything is selectable, preferring a provider
  // that can actually answer right now.
  useEffect(() => {
    if (provider || providers.length === 0) return
    const preferred = providers.find((candidate) => candidate.models.length > 0) ?? providers[0]!
    onChange({ providerId: preferred.id, modelId: preferred.models[0]?.id ?? '' })
  }, [provider, providers, onChange])

  // A model id from a provider that no longer lists it would fail at send time.
  useEffect(() => {
    if (!provider || provider.models.length === 0) return
    if (!provider.models.some((model) => model.id === modelId)) {
      onChange({ providerId: provider.id, modelId: provider.models[0]!.id })
    }
  }, [provider, modelId, onChange])

  const discover = async (): Promise<void> => {
    if (!provider) return
    setDiscovering(true)
    setNote(null)
    try {
      const models = await bridge.invoke('ai:discoverModels', { providerId: provider.id })
      if (models.length === 0) {
        setNote('No models came back. Check the key in Settings, or type a model id.')
      } else {
        onChange({ providerId: provider.id, modelId: models[0]!.id })
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setDiscovering(false)
    }
  }

  const hasModels = (provider?.models.length ?? 0) > 0

  return (
    <div className="rx-model-picker">
      <div className="rx-row">
        <select
          className="rx-input"
          value={providerId}
          disabled={disabled}
          aria-label="Provider"
          onChange={(event) => {
            const next = providers.find((candidate) => candidate.id === event.target.value)
            onChange({ providerId: event.target.value, modelId: next?.models[0]?.id ?? '' })
          }}
        >
          {providers.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
              {candidate.hasKey ? '' : ' (no key)'}
            </option>
          ))}
        </select>

        {hasModels ? (
          <select
            className="rx-input"
            value={modelId}
            disabled={disabled}
            aria-label="Model"
            onChange={(event) => onChange({ providerId, modelId: event.target.value })}
          >
            {provider!.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="rx-input"
            value={modelId}
            disabled={disabled}
            aria-label="Model id"
            placeholder="Model id"
            onChange={(event) => onChange({ providerId, modelId: event.target.value })}
          />
        )}
      </div>

      {hasModels ? null : (
        <div className="rx-row">
          <Button variant="outline" disabled={disabled || discovering} onClick={() => void discover()}>
            <Icon name="search" size={13} />
            {discovering ? 'Asking…' : 'Discover models'}
          </Button>
          <span className="rx-faint">or type the model id you want</span>
        </div>
      )}

      {note ? <span className="rx-faint">{note}</span> : null}
    </div>
  )
}
