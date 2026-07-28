import { describe, expect, it } from 'vitest'
import {
  RoutingConfigSchema,
  defaultRoutingConfig,
  featureLabel,
  parseRoutingConfig,
  planChain,
  resolveChain,
  shouldFailOver,
  statusOf,
  ROUTABLE_FEATURES,
  type RoutingConfig
} from '@shared/routing'

const candidate = (providerId: string, modelId = 'm') => ({ providerId, modelId })

const config = (overrides: Partial<RoutingConfig> = {}): RoutingConfig =>
  RoutingConfigSchema.parse({ enabled: true, ...overrides })

describe('routing config schema', () => {
  it('parses an empty document into working defaults', () => {
    const parsed = defaultRoutingConfig()
    expect(parsed.enabled).toBe(false)
    expect(parsed.defaultChain).toEqual([])
    expect(parsed.rules).toEqual([])
  })

  it('fills a rule with no candidate list rather than rejecting it', () => {
    const parsed = RoutingConfigSchema.parse({ rules: [{ feature: 'chat' }] })
    expect(parsed.rules[0]!.candidates).toEqual([])
  })

  it('falls back to defaults for a corrupt stored document', () => {
    expect(parseRoutingConfig({ rules: 'nonsense' })).toEqual(defaultRoutingConfig())
    expect(parseRoutingConfig(undefined)).toEqual(defaultRoutingConfig())
  })

  it('rejects a candidate missing a model', () => {
    expect(() => RoutingConfigSchema.parse({ defaultChain: [{ providerId: 'p' }] })).toThrow()
  })
})

describe('routable features', () => {
  it('covers chat, the agent and every quick action', () => {
    const ids = ROUTABLE_FEATURES.map((feature) => feature.id)
    expect(ids).toContain('chat')
    expect(ids).toContain('agent')
    expect(ids).toContain('summarize')
  })

  it('labels an unknown feature as itself rather than blank', () => {
    expect(featureLabel('chat')).toBe('Chat')
    expect(featureLabel('something-else')).toBe('something-else')
  })
})

describe('resolveChain', () => {
  it('returns nothing when routing is off', () => {
    const off = RoutingConfigSchema.parse({
      enabled: false,
      defaultChain: [candidate('a')]
    })
    expect(resolveChain(off, 'chat')).toEqual([])
  })

  it('uses the feature rule when there is one', () => {
    const cfg = config({
      defaultChain: [candidate('default')],
      rules: [{ feature: 'summarize', candidates: [candidate('local'), candidate('cloud')] }]
    })
    expect(resolveChain(cfg, 'summarize')).toEqual([candidate('local'), candidate('cloud')])
  })

  it('falls back to the default chain for a feature with no rule', () => {
    const cfg = config({
      defaultChain: [candidate('default')],
      rules: [{ feature: 'summarize', candidates: [candidate('local')] }]
    })
    expect(resolveChain(cfg, 'chat')).toEqual([candidate('default')])
  })

  it('treats an empty rule as no rule, not as "send nowhere"', () => {
    const cfg = config({
      defaultChain: [candidate('default')],
      rules: [{ feature: 'chat', candidates: [] }]
    })
    expect(resolveChain(cfg, 'chat')).toEqual([candidate('default')])
  })

  it('drops repeated candidates, which would only retry the same endpoint', () => {
    const cfg = config({
      defaultChain: [candidate('a'), candidate('a'), candidate('b')]
    })
    expect(resolveChain(cfg, 'chat')).toEqual([candidate('a'), candidate('b')])
  })

  it('keeps the same provider on two different models', () => {
    const cfg = config({ defaultChain: [candidate('a', 'big'), candidate('a', 'small')] })
    expect(resolveChain(cfg, 'chat')).toHaveLength(2)
  })
})

describe('planChain', () => {
  const requested = candidate('picked')

  it('is exactly the requested pair when routing is off', () => {
    const off = RoutingConfigSchema.parse({ defaultChain: [candidate('a')] })
    expect(planChain(off, 'chat', requested)).toEqual([requested])
  })

  it('is exactly the requested pair with routing on but nothing configured', () => {
    expect(planChain(config(), 'chat', requested)).toEqual([requested])
  })

  it('leads with the panel selection and backs it with the default chain', () => {
    const cfg = config({ defaultChain: [candidate('backup')] })
    expect(planChain(cfg, 'chat', requested)).toEqual([requested, candidate('backup')])
  })

  it('lets an explicit feature rule take the lead', () => {
    const cfg = config({
      rules: [{ feature: 'summarize', candidates: [candidate('cheap')] }]
    })
    expect(planChain(cfg, 'summarize', requested)).toEqual([candidate('cheap'), requested])
  })

  it('always keeps the requested pair somewhere, so stale routing cannot break a run', () => {
    const cfg = config({
      defaultChain: [candidate('backup')],
      rules: [{ feature: 'chat', candidates: [candidate('cheap')] }]
    })
    expect(planChain(cfg, 'chat', requested)).toEqual([
      candidate('cheap'),
      candidate('backup'),
      requested
    ])
  })

  it('does not list the requested pair twice when the rule already names it', () => {
    const cfg = config({ rules: [{ feature: 'chat', candidates: [requested] }] })
    expect(planChain(cfg, 'chat', requested)).toEqual([requested])
  })
})

describe('statusOf', () => {
  it('reads the status out of an adapter error message', () => {
    expect(statusOf(new Error('HTTP 429 Too Many Requests: slow down'))).toBe(429)
    expect(statusOf(new Error('HTTP 503 Service Unavailable'))).toBe(503)
  })

  it('reads a status property when one is carried', () => {
    expect(statusOf({ status: 500, message: 'boom' })).toBe(500)
    expect(statusOf({ statusCode: 401 })).toBe(401)
  })

  it('is null when there is no status to read', () => {
    expect(statusOf(new Error('fetch failed'))).toBeNull()
    expect(statusOf(null)).toBeNull()
  })
})

describe('shouldFailOver', () => {
  it('fails over on a rate limit', () => {
    expect(
      shouldFailOver(
        new Error(
          'HTTP 429 Too Many Requests: Rate limit reached for gpt-4o in organization org-abc ' +
            'on tokens per min (TPM): Limit 30000, Used 29863. Please try again in 274ms.'
        )
      )
    ).toBe(true)
  })

  it('fails over on server faults', () => {
    expect(shouldFailOver(new Error('HTTP 500 Internal Server Error'))).toBe(true)
    expect(
      shouldFailOver(new Error('HTTP 529 : {"type":"error","error":{"type":"overloaded_error"}}'))
    ).toBe(true)
    expect(
      shouldFailOver(new Error('HTTP 503 Service Unavailable: The model is overloaded.'))
    ).toBe(true)
  })

  it('fails over on a request timeout', () => {
    expect(shouldFailOver(new Error('HTTP 408 Request Timeout'))).toBe(true)
  })

  it('fails over on transport failures', () => {
    const fetchFailed = new TypeError('fetch failed')
    // Node's undici hangs the real reason off `cause`.
    ;(fetchFailed as { cause?: unknown }).cause = { code: 'ECONNREFUSED' }
    expect(shouldFailOver(fetchFailed)).toBe(true)
    expect(shouldFailOver(new Error('fetch failed'))).toBe(true)
    expect(shouldFailOver(new Error('socket hang up'))).toBe(true)
    expect(shouldFailOver({ code: 'UND_ERR_HEADERS_TIMEOUT', message: 'Headers Timeout Error' })).toBe(
      true
    )
    expect(shouldFailOver(new Error('request to https://api.example.com timed out'))).toBe(true)
  })

  it('does NOT fail over on an authentication failure', () => {
    expect(
      shouldFailOver(
        new Error('HTTP 401 Unauthorized: Incorrect API key provided: sk-abc***. ')
      )
    ).toBe(false)
    expect(
      shouldFailOver(
        new Error('HTTP 403 Forbidden: Your organization must be verified to use this model.')
      )
    ).toBe(false)
  })

  it('does NOT fail over on a malformed request', () => {
    expect(
      shouldFailOver(
        new Error(
          'HTTP 400 Bad Request: {"error":{"message":"max_tokens: must be greater than 0",' +
            '"type":"invalid_request_error"}}'
        )
      )
    ).toBe(false)
    expect(shouldFailOver(new Error('HTTP 404 Not Found: The model `gpt-9` does not exist'))).toBe(
      false
    )
    expect(
      shouldFailOver(new Error('HTTP 422 Unprocessable Entity: messages must not be empty'))
    ).toBe(false)
  })

  it('does NOT fail over when the user pressed Stop', () => {
    const aborted = new Error('The operation was aborted.')
    aborted.name = 'AbortError'
    expect(shouldFailOver(aborted)).toBe(false)
    expect(shouldFailOver(new Error('This operation was aborted'))).toBe(false)
  })

  it('does NOT fail over on an unrecognised fault', () => {
    expect(shouldFailOver(new Error('Anthropic returned an empty response body.'))).toBe(false)
    expect(shouldFailOver(new Error(''))).toBe(false)
    expect(shouldFailOver(undefined)).toBe(false)
  })

  it('reads a rate limit even when the transport gave no status', () => {
    expect(shouldFailOver(new Error('Rate limit exceeded, please retry'))).toBe(true)
  })
})
