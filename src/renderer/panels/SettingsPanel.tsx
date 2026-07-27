import { useState, type JSX } from 'react'
import type { ProviderStatus } from '@shared/types'
import { SEARCH_ENGINES } from '@shared/url'
import { useAppStore } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { Button, Field } from '../ui/primitives'
import { KeybindingsEditor } from './KeybindingsEditor'
import { ProviderDirectory } from './ProviderDirectory'

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
        <div className="rx-section-title">Keyboard</div>
        <KeybindingsEditor />
      </section>

      <section>
        <div className="rx-section-title">AI providers</div>
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
        <ProviderDirectory />
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
