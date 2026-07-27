import { describe, expect, it } from 'vitest'
import { ProviderManifestSchema, type ModelInfo } from '@shared/types'
import { estimateCost } from '@main/ai/cost'
import { withContext } from '@main/ai/context'
import { applyAuth } from '@main/ai/adapters/manifest'
import { makeModel, splitSystem } from '@main/ai/adapters/types'

const model = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
  ...makeModel('m', 'M'),
  ...overrides
})

describe('estimateCost', () => {
  it('prices input and output separately', () => {
    const priced = model({ inputPricePerMTok: 3, outputPricePerMTok: 15 })
    expect(estimateCost(priced, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(3)
    expect(estimateCost(priced, { inputTokens: 0, outputTokens: 1_000_000 })).toBe(15)
    expect(estimateCost(priced, { inputTokens: 500_000, outputTokens: 100_000 })).toBeCloseTo(3, 5)
  })

  it('returns zero rather than guessing when pricing is unknown', () => {
    expect(estimateCost(model(), { inputTokens: 1000, outputTokens: 1000 })).toBe(0)
    expect(estimateCost(undefined, { inputTokens: 1000, outputTokens: 1000 })).toBe(0)
    expect(
      estimateCost(model({ inputPricePerMTok: 3 }), { inputTokens: 1000, outputTokens: 1000 })
    ).toBe(0)
  })
})

describe('withContext', () => {
  const message = { id: '1', role: 'user' as const, content: 'hi', createdAt: 0 }

  it('is a no-op with no shared tabs', () => {
    expect(withContext([message], [])).toEqual([message])
  })

  it('prepends exactly one system message covering every tab', () => {
    const result = withContext(
      [message],
      [
        { tabId: 't1', url: 'https://a.test', title: 'A', text: 'alpha', selection: '' },
        { tabId: 't2', url: 'https://b.test', title: 'B', text: 'beta', selection: 'chosen' }
      ]
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.role).toBe('system')
    expect(result[0]!.content).toContain('https://a.test')
    expect(result[0]!.content).toContain('alpha')
    expect(result[0]!.content).toContain('Selected text:\nchosen')
    expect(result[1]).toEqual(message)
  })
})

describe('splitSystem', () => {
  it('hoists system turns and joins them', () => {
    const { system, rest } = splitSystem([
      { id: '1', role: 'system', content: 'one', createdAt: 0 },
      { id: '2', role: 'user', content: 'hi', createdAt: 0 },
      { id: '3', role: 'system', content: 'two', createdAt: 0 }
    ])
    expect(system).toBe('one\n\ntwo')
    expect(rest.map((message) => message.id)).toEqual(['2'])
  })

  it('returns an empty system string when there are none', () => {
    expect(splitSystem([{ id: '1', role: 'user', content: 'x', createdAt: 0 }]).system).toBe('')
  })
})

describe('manifest auth', () => {
  const base = { endpoint: 'https://api.example.com/v1/chat' }

  it('sets a bearer header', () => {
    const manifest = ProviderManifestSchema.parse({ ...base, authStyle: 'bearer' })
    expect(applyAuth(manifest, 'secret').headers.Authorization).toBe('Bearer secret')
  })

  it('sets a raw api-key header under the configured name', () => {
    const manifest = ProviderManifestSchema.parse({
      ...base,
      authStyle: 'x-api-key',
      authKey: 'x-api-key'
    })
    expect(applyAuth(manifest, 'secret').headers['x-api-key']).toBe('secret')
  })

  it('appends a query parameter', () => {
    const manifest = ProviderManifestSchema.parse({
      ...base,
      authStyle: 'query-param',
      authKey: 'key'
    })
    expect(applyAuth(manifest, 'secret').url).toBe('https://api.example.com/v1/chat?key=secret')
  })

  it('sends nothing when there is no key', () => {
    const manifest = ProviderManifestSchema.parse({ ...base, authStyle: 'bearer' })
    expect(applyAuth(manifest, null).headers.Authorization).toBeUndefined()
  })

  it('merges static headers', () => {
    const manifest = ProviderManifestSchema.parse({
      ...base,
      authStyle: 'none',
      headers: { 'x-org': 'radius' }
    })
    expect(applyAuth(manifest, null).headers['x-org']).toBe('radius')
  })

  it('refuses a non-http endpoint', () => {
    const manifest = ProviderManifestSchema.parse({
      endpoint: 'https://ok.test/x',
      authStyle: 'none'
    })
    expect(() => applyAuth({ ...manifest, endpoint: 'file:///etc/passwd' }, null)).toThrow(
      /http or https/
    )
  })
})

describe('makeModel', () => {
  it('defaults pricing to null rather than zero', () => {
    const built = makeModel('id', 'Label')
    expect(built.inputPricePerMTok).toBeNull()
    expect(built.capabilities.streaming).toBe(true)
    expect(built.capabilities.tools).toBe(false)
  })
})
