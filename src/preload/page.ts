/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/**
 * Runs inside every web page Radius loads, in an isolated world.
 *
 * It exposes nothing to the page -- there is no `contextBridge` call here on
 * purpose. Its whole job is to answer main's request for readable text when
 * the user puts a tab into the AI's context, so untrusted page script has no
 * surface to reach.
 */

const EXTRACT_REQUEST = 'radius:extract-request'
const EXTRACT_RESULT = 'radius:extract-result'

/** Roughly 30k characters -- enough for a long article, short of a token blowout. */
const MAX_TEXT_LENGTH = 30_000

const STRIPPED_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]'
].join(',')

/**
 * Pulls the readable body text out of the page.
 *
 * Cloning first means the stripping never mutates what the user is looking at.
 * `innerText` rather than `textContent` because it respects CSS visibility and
 * collapses whitespace the way a reader would.
 */
function extractText(): string {
  const body = document.body
  if (!body) return ''

  const clone = body.cloneNode(true) as HTMLElement
  for (const node of Array.from(clone.querySelectorAll(STRIPPED_SELECTORS))) {
    node.remove()
  }

  const main = clone.querySelector('main, article, [role="main"]')
  const source = main instanceof HTMLElement ? main : clone
  const text = (source.innerText || source.textContent || '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}\n…[truncated]` : text
}

ipcRenderer.on(EXTRACT_REQUEST, (_event, requestId: string) => {
  let payload: { title: string; text: string; selection: string }
  try {
    payload = {
      title: document.title,
      text: extractText(),
      selection: window.getSelection()?.toString() ?? ''
    }
  } catch {
    // A hostile or half-loaded page must not wedge the request; reply empty.
    payload = { title: document.title, text: '', selection: '' }
  }
  ipcRenderer.send(EXTRACT_RESULT, requestId, payload)
})
