import { useMemo, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  CATEGORY_LABELS,
  catalogByCategory,
  resolveBaseUrl,
  type CatalogEntry
} from '@shared/provider-catalog'
import { useAppStore } from '../store/useAppStore'
import { bridge } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon } from '../ui/Icon'
import { Button } from '../ui/primitives'

/**
 * Pick a provider, paste a key, done.
 *
 * Radius could always reach any OpenAI-compatible endpoint; what stopped people
 * was having to go and find the base URL first. This turns that into a list.
 */
export function ProviderDirectory(): JSX.Element {
  const providers = useAppStore((store) => store.state.providers)
  const { spring } = useMotionTokens()

  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const configured = useMemo(() => {
    const byId = new Set(providers.map((provider) => provider.id))
    const byUrl = new Set(providers.map((provider) => provider.baseUrl).filter(Boolean))
    const byLabel = new Set(providers.map((provider) => provider.label.toLowerCase()))
    return { byId, byUrl, byLabel }
  }, [providers])

  const isConfigured = (entry: CatalogEntry): boolean =>
    configured.byId.has(entry.id) ||
    configured.byLabel.has(entry.label.toLowerCase()) ||
    (entry.baseUrl !== null && configured.byUrl.has(entry.baseUrl))

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return catalogByCategory()
      .map(([category, entries]) => {
        const matched = needle
          ? entries.filter(
              (entry) =>
                entry.label.toLowerCase().includes(needle) ||
                entry.id.includes(needle) ||
                (entry.baseUrl ?? '').toLowerCase().includes(needle)
            )
          : entries
        return [category, matched] as const
      })
      .filter(([, entries]) => entries.length > 0)
  }, [query])

  return (
    <div className="rx-card">
      <div className="rx-row-between">
        <strong>Add a provider</strong>
        <span className="rx-faint">{providers.length} configured</span>
      </div>

      <input
        className="rx-input"
        placeholder="Search providers…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {groups.length === 0 ? (
        <span className="rx-faint">
          No match. Use “Anything else (OpenAI-compatible)” for an endpoint not listed here.
        </span>
      ) : null}

      {groups.map(([category, entries]) => (
        <section key={category}>
          <div className="rx-section-title">{CATEGORY_LABELS[category]}</div>
          {entries.map((entry) => (
            <div key={entry.id}>
              <button
                type="button"
                className="rx-directory-row"
                data-blocked={entry.kind === 'blocked' ? 'true' : 'false'}
                onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
              >
                <Icon name={openId === entry.id ? 'chevron-down' : 'chevron-right'} size={14} />
                <span className="rx-tab-title">{entry.label}</span>
                {isConfigured(entry) ? (
                  <span className="rx-success rx-inline">
                    <Icon name="check" size={13} />
                    added
                  </span>
                ) : null}
                {!entry.requiresKey ? <span className="rx-faint">no key</span> : null}
                {entry.kind === 'blocked' ? <span className="rx-faint">unavailable</span> : null}
              </button>

              <AnimatePresence initial={false}>
                {openId === entry.id ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={spring('panel')}
                    style={{ overflow: 'hidden' }}
                  >
                    <EntryForm entry={entry} onDone={() => setOpenId(null)} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

function EntryForm({ entry, onDone }: { entry: CatalogEntry; onDone: () => void }): JSX.Element {
  const providers = useAppStore((store) => store.state.providers)
  const [values, setValues] = useState<Record<string, string>>({})
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (entry.kind === 'blocked') {
    return (
      <div className="rx-directory-body">
        <span className="rx-muted">{entry.blockedReason}</span>
      </div>
    )
  }

  const baseUrl = resolveBaseUrl(entry, values)
  const ready = Boolean(baseUrl) && (!entry.requiresKey || apiKey.trim().length > 0)

  /**
   * Adds the provider, stores the key, then asks the provider what models the
   * key can actually see. Discovery is the step that makes the entry usable, so
   * it runs here rather than waiting for the user to find the button.
   */
  const add = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      // Most catalogue entries are seeded at first launch, so the common case is
      // attaching a key to a row that already exists. Only a templated endpoint
      // -- or one the user removed and is now re-adding -- creates a new row.
      const seeded = providers.find((provider) => provider.id === entry.id)
      const providerId =
        seeded?.id ??
        (
          await bridge.invoke('ai:addOpenAiCompatible', {
            label: entry.label,
            baseUrl: baseUrl!,
            models: []
          })
        ).id

      if (apiKey.trim()) {
        await bridge.invoke('ai:setKey', { providerId, key: apiKey.trim() })
      }

      const models = await bridge.invoke('ai:discoverModels', { providerId })
      setApiKey('')
      setStatus({
        ok: true,
        message:
          models.length > 0
            ? `Added. ${models.length} models available.`
            : 'Added, but no models came back — check the key or base URL, then press Test.'
      })
      if (models.length > 0) window.setTimeout(onDone, 900)
    } catch (error) {
      setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rx-directory-body">
      {entry.note ? <span className="rx-faint">{entry.note}</span> : null}

      {(entry.placeholders ?? []).map((placeholder) => (
        <label key={placeholder.key} className="rx-field">
          <span className="rx-label">{placeholder.label}</span>
          <input
            className="rx-input"
            placeholder={placeholder.hint}
            value={values[placeholder.key] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [placeholder.key]: event.target.value }))
            }
          />
        </label>
      ))}

      {entry.requiresKey ? (
        <label className="rx-field">
          <span className="rx-label rx-inline">
            <Icon name="key" size={13} />
            API key
          </span>
          <input
            className="rx-input"
            type="password"
            autoComplete="off"
            placeholder="Paste your key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      ) : null}

      {baseUrl ? <span className="rx-faint">Endpoint: {baseUrl}</span> : null}

      <div className="rx-row">
        <Button variant="primary" disabled={!ready || busy} onClick={() => void add()}>
          {busy ? 'Adding…' : entry.kind === 'native' ? 'Save key' : 'Add'}
        </Button>
        {entry.apiKeyUrl ? (
          <Button
            variant="outline"
            onClick={() => void bridge.invoke('tabs:create', { url: entry.apiKeyUrl! })}
          >
            <Icon name="external" size={14} />
            Get a key
          </Button>
        ) : null}
      </div>

      {status ? (
        <span className={status.ok ? 'rx-success' : 'rx-danger'}>{status.message}</span>
      ) : null}
    </div>
  )
}
