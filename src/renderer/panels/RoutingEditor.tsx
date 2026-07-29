import { useMemo, type JSX } from 'react'
import type { ProviderStatus } from '@shared/types'
import {
  ROUTABLE_FEATURES,
  parseRoutingConfig,
  type RoutingCandidate,
  type RoutingConfig
} from '@shared/routing'
import { useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { Icon } from '../ui/Icon'
import { Button, Field } from '../ui/primitives'

/**
 * Per-feature model routing with fallback chains.
 *
 * A chain is an ordered list of provider+model pairs. A run walks it and stops
 * at the first one that answers; it only moves on for failures that a different
 * provider could plausibly survive (a rate limit, a 5xx, a dead socket) and
 * never once tokens have started arriving.
 */
export function RoutingEditor(): JSX.Element {
  const settings = useAppStore((store) => store.state.settings)
  const providers = useAppStore((store) => store.state.providers)

  const routing = useMemo(() => parseRoutingConfig(settings.aiRouting), [settings.aiRouting])
  const usable = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.models.length > 0),
    [providers]
  )

  const write = (next: RoutingConfig): void => {
    send('ai:setRouting', { config: next })
  }

  const setDefaultChain = (candidates: RoutingCandidate[]): void => {
    write({ ...routing, defaultChain: candidates })
  }

  const setRuleChain = (feature: string, candidates: RoutingCandidate[]): void => {
    const rules = routing.rules.filter((rule) => rule.feature !== feature)
    write({
      ...routing,
      rules: candidates.length > 0 ? [...rules, { feature, candidates }] : rules
    })
  }

  const chainFor = (feature: string): RoutingCandidate[] =>
    routing.rules.find((rule) => rule.feature === feature)?.candidates ?? []

  if (usable.length === 0) {
    return (
      <div className="rx-card">
        <span className="rx-faint">
          Routing needs at least one provider with models. Add a key and run Discover models first.
        </span>
      </div>
    )
  }

  return (
    <div className="rx-card">
      <label className="rx-row">
        <input
          type="checkbox"
          checked={routing.enabled}
          onChange={(event) => write({ ...routing, enabled: event.target.checked })}
        />
        <span>Route by feature, with fallbacks</span>
      </label>

      <span className="rx-faint">
        With this off, every request goes to whatever the panel has selected. With it on, a
        feature with a rule uses that rule; everything else keeps the panel&apos;s choice and falls
        back down the default chain.
      </span>

      <ChainEditor
        label="Default chain"
        providers={usable}
        candidates={routing.defaultChain}
        onChange={setDefaultChain}
      />

      {ROUTABLE_FEATURES.map((feature) => (
        <ChainEditor
          key={feature.id}
          label={feature.label}
          providers={usable}
          candidates={chainFor(feature.id)}
          onChange={(candidates) => setRuleChain(feature.id, candidates)}
        />
      ))}
    </div>
  )
}

interface ChainEditorProps {
  label: string
  providers: ProviderStatus[]
  candidates: RoutingCandidate[]
  onChange: (candidates: RoutingCandidate[]) => void
}

/** One ordered chain: a row per candidate, plus a row that adds one. */
function ChainEditor({ label, providers, candidates, onChange }: ChainEditorProps): JSX.Element {
  const replace = (index: number, next: RoutingCandidate): void => {
    onChange(candidates.map((candidate, position) => (position === index ? next : candidate)))
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= candidates.length) return
    const next = [...candidates]
    const [held] = next.splice(index, 1)
    next.splice(target, 0, held!)
    onChange(next)
  }

  const add = (): void => {
    const provider = providers[0]
    if (!provider?.models[0]) return
    onChange([...candidates, { providerId: provider.id, modelId: provider.models[0].id }])
  }

  return (
    <Field label={label}>
      {candidates.length === 0 ? <span className="rx-faint">No chain — uses the default.</span> : null}

      {candidates.map((candidate, index) => {
        const provider = providers.find((entry) => entry.id === candidate.providerId)
        return (
          <div className="rx-row" key={`${candidate.providerId}-${candidate.modelId}-${index}`}>
            <span className="rx-faint">{index + 1}.</span>
            <select
              className="rx-input"
              value={candidate.providerId}
              onChange={(event) => {
                const next = providers.find((entry) => entry.id === event.target.value)
                replace(index, {
                  providerId: event.target.value,
                  modelId: next?.models[0]?.id ?? candidate.modelId
                })
              }}
            >
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <select
              className="rx-input"
              value={candidate.modelId}
              onChange={(event) => replace(index, { ...candidate, modelId: event.target.value })}
            >
              {(provider?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <Button variant="ghost" aria-label="Move up" onClick={() => move(index, -1)}>
              ↑
            </Button>
            <Button variant="ghost" aria-label="Move down" onClick={() => move(index, 1)}>
              ↓
            </Button>
            <Button
              variant="danger"
              aria-label="Remove"
              onClick={() => onChange(candidates.filter((_, position) => position !== index))}
            >
              <Icon name="close" size={12} />
            </Button>
          </div>
        )
      })}

      <Button variant="outline" onClick={add}>
        Add fallback
      </Button>
    </Field>
  )
}
