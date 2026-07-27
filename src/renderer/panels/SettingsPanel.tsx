import { useState, type JSX } from 'react'
import type { ProviderStatus } from '@shared/types'
import { SEARCH_ENGINES } from '@shared/url'
import { useAppStore } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { Button, Field } from '../ui/primitives'

/**
 * Provider setup and browser behaviour.
 *
 * Keys are write-only from here: the panel can set or clear one and can see
 * that a provider *has* one, but the value never comes back over IPC.
 */
export function SettingsPanel(): JSX.Element {
  const providers = useAppStore((store) => store.state.providers)
  const settings = useAppStore((store) => store.state.settings)

  return (
    <div className="rx-panel-scroll">
      <section>
        <div className="rx-section-title">Browsing</div>
        <div className="rx-card">
          <Field label="Search engine">
            <select
              className="rx-input"
              value={typeof settings.searchEngineId === 'string' ? settings.searchEngineId : 'duckduckgo'}
              onChange={(event) => send('settings:set', { key: 'searchEngineId', value: event.target.value })}
            >
              {SEARCH_ENGINES.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Suspend background tabs after (minutes)">
            <input
              className="rx-input"
              type="number"
              min={1}
              max={480}
              value={typeof settings.suspensionIdleMinutes === 'number' ? settings.suspensionIdleMinutes : 20}
              onChange={(event) =>
                send('settings:set', {
                  key: 'suspensionIdleMinutes',
                  value: Number.parseInt(event.target.value, 10) || 20
                })
              }
            />
          </Field>
        </div>
      </section>

      <section>
        <div className="rx-section-title">AI providers</div>
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
        <AddProviderForms />
      </section>
    </div>
  )
}

function ProviderCard({ provider }: { provider: ProviderStatus }): JSX.Element {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (task: () => Promise<void>) => async (): Promise<void> => {
    setBusy(true)
    try {
      await task()
    } catch (error) {
      setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rx-card" style={{ marginBottom: 'var(--rx-space-2)' }}>
      <div className="rx-row-between">
        <strong>{provider.label}</strong>
        <span className="rx-faint">
          {provider.tier} · {provider.models.length} models
        </span>
      </div>

      <div className="rx-row">
        <input
          className="rx-input"
          type="password"
          autoComplete="off"
          placeholder={provider.hasKey ? '•••••••• stored in the OS keychain' : 'Paste API key'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button
          variant="primary"
          disabled={!key.trim() || busy}
          onClick={run(async () => {
            await bridge.invoke('ai:setKey', { providerId: provider.id, key: key.trim() })
            setKey('')
            setStatus({ ok: true, message: 'Key saved.' })
          })}
        >
          Save
        </Button>
        {provider.hasKey ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={run(async () => {
              await bridge.invoke('ai:clearKey', { providerId: provider.id })
              setStatus({ ok: true, message: 'Key removed.' })
            })}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <div className="rx-row">
        <Button
          variant="outline"
          disabled={busy}
          onClick={run(async () => {
            const result = await bridge.invoke('ai:testProvider', { providerId: provider.id })
            setStatus(result)
          })}
        >
          Test
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={run(async () => {
            const models = await bridge.invoke('ai:discoverModels', { providerId: provider.id })
            setStatus({ ok: true, message: `Found ${models.length} models.` })
          })}
        >
          Discover models
        </Button>
        {provider.tier !== 'native' ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={run(async () => {
              await bridge.invoke('ai:removeProvider', { providerId: provider.id })
            })}
          >
            Remove
          </Button>
        ) : null}
      </div>

      {status ? (
        <span className={status.ok ? 'rx-success' : 'rx-danger'} style={{ fontSize: 'var(--rx-text-n1)' }}>
          {status.message}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Tiers 2 and 3, exposed as forms.
 *
 * The OpenAI-compatible path is the one most people need -- it covers Ollama,
 * LM Studio, vLLM and most hosted vendors. The manifest path exists for APIs
 * that fit no standard shape at all.
 */
function AddProviderForms(): JSX.Element {
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1')
  const [manifestText, setManifestText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showManifest, setShowManifest] = useState(false)

  return (
    <div className="rx-card">
      <strong>Add a provider</strong>

      <Field label="Name">
        <input
          className="rx-input"
          value={label}
          placeholder="Ollama, vLLM, a hosted vendor…"
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <Field label="OpenAI-compatible base URL">
        <input className="rx-input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </Field>

      <div className="rx-row">
        <Button
          variant="primary"
          disabled={!label.trim() || !baseUrl.trim()}
          onClick={() => {
            setError(null)
            void bridge
              .invoke('ai:addOpenAiCompatible', { label: label.trim(), baseUrl: baseUrl.trim(), models: [] })
              .then((created) => bridge.invoke('ai:discoverModels', { providerId: created.id }))
              .then(() => setLabel(''))
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
          }}
        >
          Add
        </Button>
        <Button variant="outline" onClick={() => setShowManifest((current) => !current)}>
          {showManifest ? 'Hide' : 'Custom API (JSON manifest)'}
        </Button>
      </div>

      {showManifest ? (
        <Field label="Manifest">
          <textarea
            className="rx-textarea"
            style={{ minHeight: 160, fontFamily: 'var(--rx-font-mono)' }}
            value={manifestText}
            placeholder={MANIFEST_EXAMPLE}
            onChange={(event) => setManifestText(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={!label.trim() || !manifestText.trim()}
            onClick={() => {
              setError(null)
              try {
                const manifest = JSON.parse(manifestText) as Record<string, unknown>
                void bridge
                  .invoke('ai:addManifestProvider', {
                    label: label.trim(),
                    // Validated against ProviderManifestSchema on the main side.
                    manifest: manifest as never,
                    models: []
                  })
                  .then(() => {
                    setManifestText('')
                    setLabel('')
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause))
                  )
              } catch {
                setError('That is not valid JSON.')
              }
            }}
          >
            Add custom provider
          </Button>
        </Field>
      ) : null}

      {error ? <span className="rx-danger">{error}</span> : null}
    </div>
  )
}

const MANIFEST_EXAMPLE = `{
  "endpoint": "https://api.example.com/v1/chat",
  "authStyle": "bearer",
  "authKey": "Authorization",
  "modelField": "model",
  "messagesField": "messages",
  "streamFormat": "sse",
  "deltaPath": "choices.0.delta.content",
  "textPath": "choices.0.message.content"
}`
