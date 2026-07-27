import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import type { AgentAction, AgentPageMap, AgentStepResult } from '@shared/agent'

const AGENT_CURSOR = 'radius:agent-cursor'
const AGENT_DESCRIBE = 'radius:agent-describe'
const AGENT_ELEMENTS = 'radius:agent-elements'

const DESCRIBE_TIMEOUT_MS = 3_000
/** Frames used to glide the cursor to a target, so the user can follow it. */
const MOVE_STEPS = 14
const MOVE_FRAME_MS = 16

export interface CursorPresence {
  visible: boolean
  x: number
  y: number
  label: string
  accent: string
  action: 'idle' | 'moving' | 'clicking' | 'typing'
}

export interface AgentTarget {
  contents: WebContents | undefined
  /** Page zoom, needed to convert CSS pixels into input-event coordinates. */
  zoom: number
}

/**
 * Drives a page with a synthetic mouse and keyboard, and shows where it is.
 *
 * Input is dispatched with `sendInputEvent` rather than by calling
 * `element.click()` from the preload. Synthetic DOM clicks are untrusted
 * events that plenty of sites ignore, and they cannot type into a React input
 * convincingly. Real input events behave exactly like a person's.
 *
 * The visible cursor is not decoration. It is the safety property: the agent
 * cannot touch anything without the user seeing where it is and what it just
 * did, and it moves in visible steps rather than teleporting.
 */
export class AgentController {
  private readonly pending = new Map<string, (map: AgentPageMap) => void>()
  private cursor: CursorPresence = {
    visible: false,
    x: 0,
    y: 0,
    label: 'Assistant',
    accent: 'oklch(0.70 0.17 285)',
    action: 'idle'
  }

  private stopped = false

  constructor() {
    ipcMain.on(AGENT_ELEMENTS, (_event, requestId: string, payload: AgentPageMap) => {
      const resolve = this.pending.get(requestId)
      if (!resolve) return
      this.pending.delete(requestId)
      resolve(payload)
    })
  }

  /* ------------------------------------------------------------ presence */

  setPresence(target: AgentTarget, patch: Partial<CursorPresence>): void {
    this.cursor = { ...this.cursor, ...patch }
    this.push(target)
  }

  private push(target: AgentTarget): void {
    if (!target.contents || target.contents.isDestroyed()) return
    target.contents.send(AGENT_CURSOR, this.cursor)
  }

  /** Hides the cursor and cancels any run in progress. */
  stop(target: AgentTarget): void {
    this.stopped = true
    this.setPresence(target, { visible: false, action: 'idle' })
  }

  begin(target: AgentTarget, label: string, accent: string): void {
    this.stopped = false
    this.setPresence(target, {
      visible: true,
      label,
      accent,
      action: 'idle',
      x: 40,
      y: 40
    })
  }

  /* ------------------------------------------------------------ reading */

  /** Asks the page's preload for the numbered map of what is on screen. */
  async describe(target: AgentTarget): Promise<AgentPageMap> {
    const empty: AgentPageMap = {
      url: '',
      title: '',
      scrollY: 0,
      scrollHeight: 0,
      viewportHeight: 0,
      elements: []
    }
    if (!target.contents || target.contents.isDestroyed()) return empty

    const requestId = randomUUID()
    const result = await new Promise<AgentPageMap | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(null)
      }, DESCRIBE_TIMEOUT_MS)

      this.pending.set(requestId, (map) => {
        clearTimeout(timer)
        resolve(map)
      })

      target.contents!.send(AGENT_DESCRIBE, requestId)
    })

    return result ?? empty
  }

  /* ------------------------------------------------------------ acting */

  async perform(target: AgentTarget, action: AgentAction): Promise<AgentStepResult> {
    if (this.stopped) return { ok: false, detail: 'Stopped by the user.' }
    if (!target.contents || target.contents.isDestroyed()) {
      return { ok: false, detail: 'That tab is no longer open.' }
    }

    switch (action.kind) {
      case 'click': {
        const map = await this.describe(target)
        const element = map.elements[action.index]
        if (!element) return { ok: false, detail: `No element numbered ${action.index}.` }

        await this.glideTo(target, element.x, element.y)
        this.setPresence(target, { action: 'clicking' })
        this.dispatchClick(target, element.x, element.y)
        // Give the page a moment to react before the model looks again.
        await delay(600)
        this.setPresence(target, { action: 'idle' })
        return { ok: true, detail: `Clicked ${describeElement(element)}.` }
      }

      case 'type': {
        if (action.index !== undefined) {
          const map = await this.describe(target)
          const element = map.elements[action.index]
          if (!element) return { ok: false, detail: `No element numbered ${action.index}.` }
          await this.glideTo(target, element.x, element.y)
          this.setPresence(target, { action: 'clicking' })
          this.dispatchClick(target, element.x, element.y)
          await delay(180)
        }

        this.setPresence(target, { action: 'typing' })
        target.contents.focus()
        this.dispatchText(target, action.text)
        await delay(250)
        this.setPresence(target, { action: 'idle' })
        return { ok: true, detail: `Typed ${JSON.stringify(action.text)}.` }
      }

      case 'key': {
        this.setPresence(target, { action: 'typing' })
        target.contents.focus()
        target.contents.sendInputEvent({ type: 'keyDown', keyCode: action.key })
        target.contents.sendInputEvent({ type: 'keyUp', keyCode: action.key })
        await delay(400)
        this.setPresence(target, { action: 'idle' })
        return { ok: true, detail: `Pressed ${action.key}.` }
      }

      case 'scroll': {
        target.contents.sendInputEvent({
          type: 'mouseWheel',
          x: Math.round(this.cursor.x || 200),
          y: Math.round(this.cursor.y || 200),
          deltaX: 0,
          deltaY: action.amount > 0 ? -400 : 400,
          canScroll: true
        } as Parameters<WebContents['sendInputEvent']>[0])
        await delay(400)
        return { ok: true, detail: action.amount > 0 ? 'Scrolled down.' : 'Scrolled up.' }
      }

      case 'wait':
        await delay(Math.min(5_000, Math.max(200, action.ms)))
        return { ok: true, detail: `Waited ${action.ms}ms.` }

      case 'done':
        this.setPresence(target, { action: 'idle' })
        return { ok: true, detail: action.summary, finished: true }
    }
  }

  /**
   * Moves the cursor in visible increments.
   *
   * Teleporting would be faster and would defeat the point -- the user is meant
   * to be able to follow what the agent is doing, not discover it afterwards.
   * Mouse-move events are dispatched along the way so the page's own hover
   * states light up as they would for a person.
   */
  private async glideTo(target: AgentTarget, x: number, y: number): Promise<void> {
    const fromX = this.cursor.x
    const fromY = this.cursor.y

    for (let step = 1; step <= MOVE_STEPS; step += 1) {
      if (this.stopped) return
      const t = easeOut(step / MOVE_STEPS)
      const nextX = Math.round(fromX + (x - fromX) * t)
      const nextY = Math.round(fromY + (y - fromY) * t)

      this.setPresence(target, { x: nextX, y: nextY, action: 'moving' })
      target.contents?.sendInputEvent({
        type: 'mouseMove',
        x: this.scale(nextX, target.zoom),
        y: this.scale(nextY, target.zoom)
      })
      await delay(MOVE_FRAME_MS)
    }
  }

  private dispatchClick(target: AgentTarget, x: number, y: number): void {
    const point = { x: this.scale(x, target.zoom), y: this.scale(y, target.zoom) }
    target.contents?.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    target.contents?.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  }

  /** `char` events are what actually insert text; keyDown alone does not. */
  private dispatchText(target: AgentTarget, text: string): void {
    for (const character of text) {
      target.contents?.sendInputEvent({ type: 'char', keyCode: character })
    }
  }

  /**
   * Page coordinates are CSS pixels; input events are in the view's own pixels.
   * Those differ whenever the tab is zoomed.
   */
  private scale(value: number, zoom: number): number {
    return Math.round(value * (zoom || 1))
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3
}

function describeElement(element: AgentPageMap['elements'][number]): string {
  const name = element.label || element.value || element.role || element.tag
  return `${element.tag}${name ? ` “${name.slice(0, 60)}”` : ''}`
}
