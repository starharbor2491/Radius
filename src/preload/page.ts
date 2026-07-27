/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/**
 * Runs inside every web page Radius loads, in an isolated world.
 *
 * It exposes nothing to the page -- there is no `contextBridge` call here on
 * purpose. Its jobs are to answer main's request for readable text, and to draw
 * the agent's cursor when the assistant is driving.
 *
 * The cursor has to live here rather than in the chrome because the page is a
 * separate native view stacked above the chrome; anything the chrome painted
 * would be hidden behind it.
 */

const EXTRACT_REQUEST = 'radius:extract-request'
const EXTRACT_RESULT = 'radius:extract-result'
const AGENT_CURSOR = 'radius:agent-cursor'
const AGENT_DESCRIBE = 'radius:agent-describe'
const AGENT_ELEMENTS = 'radius:agent-elements'

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
    .replace(/[ \t ]+/g, ' ')
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

/* ------------------------------------------------------------------ *
 * Agent: element map
 * ------------------------------------------------------------------ */

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[contenteditable="true"]'
].join(',')

interface AgentElement {
  index: number
  tag: string
  role: string
  label: string
  value: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Numbers the things on screen the agent can act on.
 *
 * Only elements actually visible in the viewport are listed: an agent that can
 * "click" something scrolled off-screen would be dispatching input at
 * coordinates the user cannot see, which breaks the promise that you can watch
 * what it does.
 */
function describeElements(): AgentElement[] {
  const results: AgentElement[] = []
  const seen = new Set<Element>()

  for (const node of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
    if (!(node instanceof HTMLElement) || seen.has(node)) continue
    seen.add(node)

    const rect = node.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue
    if (rect.right < 0 || rect.left > window.innerWidth) continue

    const style = window.getComputedStyle(node)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
    if (node.hasAttribute('disabled') || node.getAttribute('aria-hidden') === 'true') continue

    const input = node as HTMLInputElement
    results.push({
      index: results.length,
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') ?? input.type ?? '',
      label: labelFor(node).slice(0, 120),
      value: typeof input.value === 'string' ? input.value.slice(0, 80) : '',
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })

    if (results.length >= 120) break
  }

  return results
}

/** Best available human-readable name, in the order a screen reader would try. */
function labelFor(node: HTMLElement): string {
  const aria = node.getAttribute('aria-label')
  if (aria) return aria.trim()

  const labelledBy = node.getAttribute('aria-labelledby')
  if (labelledBy) {
    const referenced = document.getElementById(labelledBy)
    if (referenced?.innerText) return referenced.innerText.trim()
  }

  const text = node.innerText?.trim()
  if (text) return text.replace(/\s+/g, ' ')

  const input = node as HTMLInputElement
  return (input.placeholder || node.getAttribute('title') || input.name || '').trim()
}

ipcRenderer.on(AGENT_DESCRIBE, (_event, requestId: string) => {
  let elements: AgentElement[] = []
  try {
    elements = describeElements()
  } catch {
    elements = []
  }
  ipcRenderer.send(AGENT_ELEMENTS, requestId, {
    url: location.href,
    title: document.title,
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.body?.scrollHeight ?? 0),
    viewportHeight: Math.round(window.innerHeight),
    elements
  })
})

/* ------------------------------------------------------------------ *
 * Agent: the visible cursor
 * ------------------------------------------------------------------ */

interface CursorState {
  visible: boolean
  x: number
  y: number
  label: string
  accent: string
  action: 'idle' | 'moving' | 'clicking' | 'typing'
}

let host: HTMLElement | null = null
let root: ShadowRoot | null = null

/**
 * The overlay lives in a shadow root so page CSS cannot restyle or hide it, and
 * `pointer-events: none` guarantees it never intercepts a click the user meant
 * for the page underneath.
 */
function ensureOverlay(): ShadowRoot | null {
  if (root && host?.isConnected) return root
  if (!document.documentElement) return null

  host = document.createElement('div')
  host.setAttribute('data-radius-agent', '')
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;'
  document.documentElement.append(host)

  root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .cursor {
        position: fixed;
        top: 0; left: 0;
        display: flex;
        align-items: flex-start;
        gap: 4px;
        pointer-events: none;
        opacity: 0;
        transform: translate3d(0, 0, 0);
        transition: transform 240ms cubic-bezier(0.2, 0, 0, 1), opacity 160ms linear;
        will-change: transform;
        font: 500 11px/1.4 ui-sans-serif, system-ui, sans-serif;
      }
      .cursor[data-visible='true'] { opacity: 1; }
      .arrow { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.45)); }
      .label {
        margin-top: 12px;
        padding: 2px 7px;
        border-radius: 999px;
        color: #fff;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .ring {
        position: fixed;
        top: 0; left: 0;
        width: 34px; height: 34px;
        margin: -17px 0 0 -17px;
        border-radius: 50%;
        border: 2px solid currentColor;
        opacity: 0;
        pointer-events: none;
      }
      .cursor[data-action='clicking'] + .ring { animation: pop 420ms ease-out; }
      .cursor[data-action='typing'] .label::after {
        content: '';
        display: inline-block;
        width: 5px; height: 5px;
        margin-left: 5px;
        border-radius: 50%;
        background: currentColor;
        animation: blink 900ms steps(2, start) infinite;
      }
      @keyframes pop {
        0%   { opacity: 0.9; transform: scale(0.4); }
        100% { opacity: 0;   transform: scale(1.6); }
      }
      @keyframes blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0.15 } }
      @media (prefers-reduced-motion: reduce) {
        .cursor { transition: none; }
        .cursor[data-action='clicking'] + .ring { animation-duration: 1ms; }
      }
    </style>
    <div class="cursor" data-visible="false">
      <svg class="arrow" width="16" height="19" viewBox="0 0 16 19" fill="none">
        <path d="M1 1l13 8.2-5.9 1.2 3 5.6-2.6 1.4-3-5.7L1 15.6V1z"
              fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
      <span class="label"></span>
    </div>
    <div class="ring"></div>
  `
  return root
}

function applyCursor(state: CursorState): void {
  const shadow = ensureOverlay()
  if (!shadow) return

  const cursor = shadow.querySelector('.cursor') as HTMLElement | null
  const ring = shadow.querySelector('.ring') as HTMLElement | null
  const label = shadow.querySelector('.label') as HTMLElement | null
  if (!cursor || !ring || !label) return

  cursor.style.color = state.accent
  ring.style.color = state.accent
  label.style.background = state.accent
  label.textContent = state.label

  cursor.dataset.visible = state.visible ? 'true' : 'false'
  // Mirrored onto the host so the cursor's state is observable from outside a
  // closed shadow root -- for debugging, and for the end-to-end test.
  if (host) {
    host.dataset.visible = String(state.visible)
    host.dataset.x = String(state.x)
    host.dataset.y = String(state.y)
    host.dataset.action = state.action
  }
  cursor.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`
  ring.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`

  // Restarting the animation requires the attribute to actually change.
  if (cursor.dataset.action !== state.action) cursor.dataset.action = state.action
  else if (state.action === 'clicking') {
    cursor.dataset.action = 'idle'
    requestAnimationFrame(() => {
      cursor.dataset.action = 'clicking'
    })
  }
}

let lastCursor: CursorState | null = null

ipcRenderer.on(AGENT_CURSOR, (_event, state: CursorState) => {
  lastCursor = state
  try {
    applyCursor(state)
  } catch {
    // Never let overlay trouble break the page.
  }
})

// A navigation blows the overlay away; put it back with the last known state.
document.addEventListener('DOMContentLoaded', () => {
  if (lastCursor) applyCursor(lastCursor)
})
