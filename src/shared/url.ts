/**
 * Omnibox input handling, shared so the renderer can preview exactly what the
 * main process will do with what you typed.
 */

export interface SearchEngine {
  id: string
  name: string
  /** `%s` is replaced with the URI-encoded query. */
  template: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  { id: 'brave', name: 'Brave', template: 'https://search.brave.com/search?q=%s' },
  { id: 'kagi', name: 'Kagi', template: 'https://kagi.com/search?q=%s' }
]

export const DEFAULT_SEARCH_ENGINE_ID = 'duckduckgo'

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const LOCALHOST_PATTERN = /^localhost(:\d+)?(\/|$)/i
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/
// A bare hostname: at least one dot, no spaces, plausible TLD.
const HOSTNAME_PATTERN = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/

export type OmniboxIntent =
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string; url: string }

/**
 * Decides whether typed text is a destination or a query.
 *
 * The ordering matters: localhost and bare IPs come first (a bare `localhost:3000`
 * is otherwise indistinguishable from a URI scheme), then anything with an
 * explicit scheme, then anything shaped like a hostname. Everything with a space in it is a search, because `foo .com` is
 * not a host but `foo.com` is.
 */
export function parseOmniboxInput(
  rawInput: string,
  engine: SearchEngine = SEARCH_ENGINES[0]!
): OmniboxIntent {
  const input = rawInput.trim()
  if (!input) return { kind: 'url', url: '' }

  // localhost:3000 parses as a scheme (`localhost:`) under RFC 3986, so it has
  // to be recognised before the scheme check or it never reaches a server.
  if (LOCALHOST_PATTERN.test(input) || IPV4_PATTERN.test(input)) {
    return { kind: 'url', url: `http://${input}` }
  }
  if (SCHEME_PATTERN.test(input)) return { kind: 'url', url: input }
  if (!/\s/.test(input) && HOSTNAME_PATTERN.test(input)) {
    return { kind: 'url', url: `https://${input}` }
  }

  return {
    kind: 'search',
    query: input,
    url: engine.template.replace('%s', encodeURIComponent(input))
  }
}

export function resolveSearchEngine(id: string | undefined): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0]!
}

/** Hostname without `www.`, for compact display in the tab strip. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * An address split into the part that identifies who you are talking to and the
 * part that does not.
 *
 * Browsers do this for a reason that is security, not decoration: an attacker's
 * advantage is a long path that pushes the real host out of view, so the host
 * has to be the thing that survives truncation and the thing the eye lands on.
 * `security` drives the leading indicator, and it reports what the scheme
 * actually is rather than reassuring.
 */
export interface DisplayUrl {
  security: 'secure' | 'plain' | 'internal'
  /** Scheme and any `www.`, shown dimmed. Empty for internal pages. */
  prefix: string
  /** The registrable host, or the scheme for an internal page. Never truncated first. */
  host: string
  /** Path, query and fragment. Truncated before anything else. */
  rest: string
}

export function formatUrlForDisplay(raw: string): DisplayUrl | null {
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    // about:, file:, data:, chrome-error: -- there is no host to emphasise, and
    // pretending otherwise would put a lock beside something that has none.
    return {
      security: 'internal',
      prefix: '',
      host: parsed.protocol.replace(/:$/, ''),
      rest: raw.slice(parsed.protocol.length).replace(/^\/\//, '')
    }
  }

  const bare = parsed.hostname.replace(/^www\./, '')
  const port = parsed.port ? `:${parsed.port}` : ''
  return {
    security: parsed.protocol === 'https:' ? 'secure' : 'plain',
    prefix: `${parsed.protocol}//${parsed.hostname === bare ? '' : 'www.'}`,
    host: `${bare}${port}`,
    rest: `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`
  }
}
