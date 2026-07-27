import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS,
  PROVIDER_CATALOG,
  catalogByCategory,
  adapterIdFor,
  findCatalogEntry,
  resolveBaseUrl,
  seedableCatalogEntries
} from '@shared/provider-catalog'

describe('the catalogue', () => {
  it('has unique ids', () => {
    const ids = PROVIDER_CATALOG.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the providers people actually ask for', () => {
    for (const id of ['openrouter', 'deepseek', 'moonshot', 'deepinfra', 'databricks', 'groq']) {
      expect(findCatalogEntry(id), id).toBeDefined()
    }
  })

  it('gives every resolvable entry an https endpoint, except local ones', () => {
    for (const entry of PROVIDER_CATALOG) {
      if (!entry.baseUrl) continue
      const local = entry.category === 'local'
      expect(entry.baseUrl.startsWith(local ? 'http://' : 'https://'), entry.id).toBe(true)
      expect(entry.baseUrl.endsWith('/'), entry.id).toBe(false)
    }
  })

  it('marks local providers as needing no key', () => {
    for (const entry of PROVIDER_CATALOG.filter((e) => e.category === 'local')) {
      expect(entry.requiresKey, entry.id).toBe(false)
    }
  })

  it('gives every templated entry placeholders that its template uses', () => {
    for (const entry of PROVIDER_CATALOG.filter((e) => e.kind === 'templated')) {
      expect(entry.template, entry.id).toBeDefined()
      expect(entry.placeholders?.length, entry.id).toBeGreaterThan(0)
      for (const placeholder of entry.placeholders!) {
        expect(entry.template, entry.id).toContain(`{${placeholder.key}}`)
      }
    }
  })

  it('explains why a blocked entry is blocked', () => {
    const blocked = PROVIDER_CATALOG.filter((entry) => entry.kind === 'blocked')
    expect(blocked.length).toBeGreaterThan(0)
    for (const entry of blocked) {
      expect(entry.blockedReason, entry.id).toBeTruthy()
      // A dead end should point somewhere useful.
      expect(entry.blockedReason!.length, entry.id).toBeGreaterThan(40)
    }
  })

  it('groups every entry under a labelled category', () => {
    const grouped = catalogByCategory().flatMap(([, entries]) => entries)
    expect(grouped).toHaveLength(PROVIDER_CATALOG.length)
    for (const [category] of catalogByCategory()) {
      expect(CATEGORY_LABELS[category]).toBeTruthy()
    }
  })
})

describe('resolveBaseUrl', () => {
  const databricks = findCatalogEntry('databricks')!
  const custom = findCatalogEntry('openai-compatible-custom')!

  it('returns a fixed base URL unchanged', () => {
    expect(resolveBaseUrl(findCatalogEntry('openrouter')!, {})).toBe('https://openrouter.ai/api/v1')
  })

  it('fills a template', () => {
    expect(resolveBaseUrl(databricks, { workspace: 'dbc-123.cloud.databricks.com' })).toBe(
      'https://dbc-123.cloud.databricks.com/serving-endpoints'
    )
  })

  it('strips a scheme the user pasted into a host field', () => {
    // People paste "https://host" into a field labelled "host" constantly.
    expect(resolveBaseUrl(databricks, { workspace: 'https://dbc-123.cloud.databricks.com/' })).toBe(
      'https://dbc-123.cloud.databricks.com/serving-endpoints'
    )
  })

  it('keeps the scheme on a field that is itself a base URL', () => {
    expect(resolveBaseUrl(custom, { baseUrl: 'http://10.0.0.5:8000/v1/' })).toBe(
      'http://10.0.0.5:8000/v1'
    )
  })

  it('returns null until every placeholder is filled', () => {
    expect(resolveBaseUrl(databricks, {})).toBeNull()
    expect(resolveBaseUrl(databricks, { workspace: '   ' })).toBeNull()
  })
})

describe('seeding', () => {
  it('seeds every provider that can actually be reached', () => {
    const seeded = seedableCatalogEntries()
    // The three with hand-written adapters, plus every fixed-URL endpoint.
    for (const id of [
      'anthropic',
      'openai',
      'google',
      'xai',
      'deepseek',
      'openrouter',
      'fireworks',
      'deepinfra',
      'cerebras',
      'groq',
      'ollama'
    ]) {
      expect(
        seeded.some((entry) => entry.id === id),
        `${id} should be seeded`
      ).toBe(true)
    }
  })

  it('leaves out entries whose URL is not yet known', () => {
    const ids = seedableCatalogEntries().map((entry) => entry.id)
    // Templated: the user has to supply a workspace or resource name first.
    expect(ids).not.toContain('databricks')
    expect(ids).not.toContain('azure-openai')
    // Blocked: no API-key path at all.
    expect(ids).not.toContain('bedrock')
    expect(ids).not.toContain('vertex')
  })

  it('routes only the native entries to a hand-written adapter', () => {
    expect(adapterIdFor(findCatalogEntry('anthropic')!)).toBe('anthropic')
    expect(adapterIdFor(findCatalogEntry('google')!)).toBe('google')
    expect(adapterIdFor(findCatalogEntry('openrouter')!)).toBeNull()
  })
})
