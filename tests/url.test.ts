import { describe, expect, it } from 'vitest'
import { displayHost, parseOmniboxInput, resolveSearchEngine, SEARCH_ENGINES } from '@shared/url'

const google = resolveSearchEngine('google')

describe('parseOmniboxInput', () => {
  it('passes through anything with an explicit scheme', () => {
    expect(parseOmniboxInput('https://example.com/a?b=c')).toEqual({
      kind: 'url',
      url: 'https://example.com/a?b=c'
    })
    expect(parseOmniboxInput('about:blank').kind).toBe('url')
    expect(parseOmniboxInput('file:///tmp/x.html').kind).toBe('url')
  })

  it('treats bare hostnames as destinations over https', () => {
    expect(parseOmniboxInput('example.com')).toEqual({ kind: 'url', url: 'https://example.com' })
    expect(parseOmniboxInput('sub.example.co.uk/path')).toEqual({
      kind: 'url',
      url: 'https://sub.example.co.uk/path'
    })
  })

  it('uses http for localhost and bare IPs, which have no TLD to key off', () => {
    expect(parseOmniboxInput('localhost:3000')).toEqual({ kind: 'url', url: 'http://localhost:3000' })
    expect(parseOmniboxInput('127.0.0.1:8080/x')).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:8080/x'
    })
  })

  it('searches anything containing whitespace, even if it looks host-like', () => {
    const result = parseOmniboxInput('example .com', google)
    expect(result.kind).toBe('search')
    expect(result.url).toBe('https://www.google.com/search?q=example%20.com')
  })

  it('searches plain words', () => {
    const result = parseOmniboxInput('how to make bread')
    expect(result.kind).toBe('search')
    expect(result.url).toContain('duckduckgo.com')
  })

  it('percent-encodes the query', () => {
    const result = parseOmniboxInput('a&b=c d', google)
    expect(result.url).toBe('https://www.google.com/search?q=a%26b%3Dc%20d')
  })

  it('returns an empty url for empty input rather than searching for nothing', () => {
    expect(parseOmniboxInput('   ')).toEqual({ kind: 'url', url: '' })
  })
})

describe('resolveSearchEngine', () => {
  it('falls back to the first engine for unknown or missing ids', () => {
    expect(resolveSearchEngine(undefined).id).toBe(SEARCH_ENGINES[0]!.id)
    expect(resolveSearchEngine('nope').id).toBe(SEARCH_ENGINES[0]!.id)
    expect(resolveSearchEngine('kagi').id).toBe('kagi')
  })

  it('gives every engine a %s placeholder', () => {
    for (const engine of SEARCH_ENGINES) expect(engine.template).toContain('%s')
  })
})

describe('displayHost', () => {
  it('strips the www prefix', () => {
    expect(displayHost('https://www.example.com/x')).toBe('example.com')
  })

  it('returns the input unchanged when it is not a URL', () => {
    expect(displayHost('not a url')).toBe('not a url')
  })
})
