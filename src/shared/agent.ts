import { z } from 'zod'

/**
 * The agent's action vocabulary.
 *
 * Deliberately tiny, and expressed as JSON rather than as provider tool-calls.
 * Tool-calling APIs differ per vendor and are missing entirely from a good
 * number of the OpenAI-compatible endpoints Radius supports, so asking any
 * model for one JSON object per step is what makes the agent work on *every*
 * provider rather than the three that have the fanciest API.
 */

export const AgentElementSchema = z.object({
  index: z.number().int(),
  tag: z.string(),
  role: z.string(),
  label: z.string(),
  value: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})
export type AgentElement = z.infer<typeof AgentElementSchema>

export const AgentPageMapSchema = z.object({
  url: z.string(),
  title: z.string(),
  scrollY: z.number(),
  scrollHeight: z.number(),
  viewportHeight: z.number(),
  elements: z.array(AgentElementSchema)
})
export type AgentPageMap = z.infer<typeof AgentPageMapSchema>

export const AgentActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), index: z.number().int().min(0) }),
  z.object({
    kind: z.literal('type'),
    text: z.string(),
    /** Click this element first, so typing lands in the right field. */
    index: z.number().int().min(0).optional()
  }),
  z.object({ kind: z.literal('key'), key: z.string() }),
  z.object({ kind: z.literal('scroll'), amount: z.number() }),
  z.object({ kind: z.literal('wait'), ms: z.number().int() }),
  z.object({ kind: z.literal('done'), summary: z.string() })
])
export type AgentAction = z.infer<typeof AgentActionSchema>

export interface AgentStepResult {
  ok: boolean
  detail: string
  finished?: boolean
}

/** One line in the visible activity log. */
export const AgentStepSchema = z.object({
  id: z.string(),
  action: z.string(),
  detail: z.string(),
  ok: z.boolean(),
  at: z.number().int()
})
export type AgentStep = z.infer<typeof AgentStepSchema>

/** Hard ceiling on a single run, regardless of what the model asks for. */
export const MAX_AGENT_STEPS = 15

export const AGENT_SYSTEM_PROMPT = `You are driving a web browser on the user's behalf, with a real mouse and keyboard.

Each turn you are shown the current page and a numbered list of the elements visible on screen. Reply with EXACTLY ONE JSON object and nothing else -- no prose, no markdown fence.

Actions:
  {"kind":"click","index":N}                  click element N
  {"kind":"type","text":"...","index":N}      click element N, then type
  {"kind":"key","key":"Return"}               press a key (Return, Tab, Escape, Backspace)
  {"kind":"scroll","amount":1}                1 scrolls down, -1 scrolls up
  {"kind":"wait","ms":800}                    wait for the page to settle
  {"kind":"done","summary":"..."}             finished; say what you found or did

Rules:
- Only ever reference an index from the list you were just given. It changes every turn.
- After clicking something that navigates, expect a completely new list.
- If the thing you need is not on screen, scroll rather than guessing.
- Stop with "done" as soon as the task is complete or you are stuck. Say plainly if you are stuck.
- Never enter passwords, payment details, or anything on a checkout or login form. If the task needs one, stop with "done" and explain that the user should do that part.`

/**
 * Pulls the action object out of a model reply.
 *
 * Models wrap JSON in prose or code fences no matter how firmly they are asked
 * not to, so this scans for the first balanced object rather than trusting the
 * whole reply to parse.
 */
export function parseAgentAction(reply: string): AgentAction | null {
  const candidates: string[] = []

  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi
  for (const match of reply.matchAll(fenced)) {
    if (match[1]) candidates.push(match[1].trim())
  }

  const start = reply.indexOf('{')
  if (start !== -1) {
    let depth = 0
    for (let index = start; index < reply.length; index += 1) {
      if (reply[index] === '{') depth += 1
      else if (reply[index] === '}') {
        depth -= 1
        if (depth === 0) {
          candidates.push(reply.slice(start, index + 1))
          break
        }
      }
    }
  }

  candidates.push(reply.trim())

  for (const candidate of candidates) {
    try {
      const parsed = AgentActionSchema.safeParse(JSON.parse(candidate))
      if (parsed.success) return parsed.data
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

/** Renders the page map into the compact form the model sees each turn. */
export function formatPageMap(map: AgentPageMap): string {
  const lines = map.elements.map((element) => {
    const name = element.label || element.value || '(no label)'
    const role = element.role ? `/${element.role}` : ''
    return `[${element.index}] <${element.tag}${role}> ${name}`
  })

  const scrolled = map.scrollHeight > map.viewportHeight
    ? ` (scrolled ${map.scrollY}px of ${map.scrollHeight - map.viewportHeight}px)`
    : ''

  return [
    `URL: ${map.url}`,
    `Title: ${map.title}${scrolled}`,
    '',
    lines.length > 0 ? 'Elements on screen:' : 'No interactive elements are visible on screen.',
    ...lines
  ].join('\n')
}
