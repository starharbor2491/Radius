import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ChatMessage } from '@shared/types'
import {
  AGENT_SYSTEM_PROMPT,
  MAX_AGENT_STEPS,
  formatPageMap,
  parseAgentAction,
  type AgentStep
} from '@shared/agent'
import { useActiveTab } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { useTheme } from '../theme/ThemeProvider'
import { ModelPicker, useSelectableProviders, type ModelSelection } from '../ui/ModelPicker'
import { Button } from '../ui/primitives'

type RunState = 'idle' | 'thinking' | 'acting' | 'stopped' | 'finished' | 'error'

/**
 * The assistant working alongside you.
 *
 * Each turn: read the page, ask the model for one JSON action, perform it with
 * a real cursor and keyboard, repeat. The loop lives here rather than in main
 * because the model call is the same streaming path the chat panel uses, and
 * this panel already owns provider and model selection.
 *
 * The run is bounded three ways: a hard step ceiling, a Stop button that
 * cancels mid-action, and a cursor the user can see the whole time.
 */
export function AgentPanel(): JSX.Element {
  const activeTab = useActiveTab()
  const { theme } = useTheme()
  const { spring, tween, stagger } = useMotionTokens()

  const [goal, setGoal] = useState('')
  const [runState, setRunState] = useState<RunState>('idle')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')

  const stopRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  const usableProviders = useSelectableProviders()
  const provider = usableProviders.find((candidate) => candidate.id === providerId)

  const select = useCallback((selection: ModelSelection) => {
    setProviderId(selection.providerId)
    setModelId(selection.modelId)
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [steps])

  const appendStep = useCallback((step: Omit<AgentStep, 'id' | 'at'>) => {
    setSteps((current) => [
      ...current,
      { ...step, id: crypto.randomUUID(), at: Date.now() }
    ])
  }, [])

  /**
   * One model call, collected from the stream.
   *
   * The agent needs a whole action before it can act, so unlike chat this waits
   * for the terminal event rather than rendering deltas.
   */
  const ask = useCallback(
    (messages: ChatMessage[]): Promise<string> =>
      new Promise((resolve, reject) => {
        const runId = crypto.randomUUID()
        let text = ''

        const off = bridge.on('ai:stream', (event) => {
          if (event.runId !== runId) return
          if (event.type === 'delta') text += event.text
          // Neither a notice (a fallback provider taking over, a budget warning)
          // nor streamed reasoning is the answer or a failure; the loop keeps
          // waiting for one. Reasoning in particular must stay out of `text`, or
          // the model's thinking would be parsed as its chosen action.
          else if (event.type === 'notice' || event.type === 'reasoning') return
          else if (event.type === 'done') {
            off()
            resolve(text)
          } else {
            off()
            reject(new Error(event.message))
          }
        })

        send('ai:send', {
          runId,
          providerId: provider!.id,
          modelId,
          messages,
          contextTabIds: [],
          feature: 'agent'
        })
      }),
    [provider, modelId]
  )

  const stop = useCallback(() => {
    stopRef.current = true
    if (activeTab) send('agent:stop', { tabId: activeTab.id })
    setRunState('stopped')
  }, [activeTab])

  const run = useCallback(async () => {
    if (!activeTab || !provider || !modelId || !goal.trim()) return

    stopRef.current = false
    setSteps([])
    setError(null)
    setRunState('thinking')

    const tabId = activeTab.id
    send('agent:begin', {
      tabId,
      label: provider.label,
      accent: theme.colors.accent
    })

    const transcript: ChatMessage[] = [
      { id: 'sys', role: 'system', content: AGENT_SYSTEM_PROMPT, createdAt: Date.now() },
      { id: 'goal', role: 'user', content: `Task: ${goal.trim()}`, createdAt: Date.now() }
    ]

    try {
      for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
        if (stopRef.current) break

        setRunState('thinking')
        const map = await bridge.invoke('agent:describe', { tabId })
        transcript.push({
          id: `page-${step}`,
          role: 'user',
          content: formatPageMap(map),
          createdAt: Date.now()
        })

        const reply = await ask(transcript)
        if (stopRef.current) break

        const action = parseAgentAction(reply)
        if (!action) {
          appendStep({ action: 'confused', detail: reply.slice(0, 200), ok: false })
          setError('The model did not return a usable action. Try a more specific task.')
          setRunState('error')
          break
        }

        transcript.push({
          id: `act-${step}`,
          role: 'assistant',
          content: JSON.stringify(action),
          createdAt: Date.now()
        })

        if (action.kind === 'done') {
          appendStep({ action: 'done', detail: action.summary, ok: true })
          setRunState('finished')
          break
        }

        setRunState('acting')
        const result = await bridge.invoke('agent:act', { tabId, action })
        appendStep({ action: action.kind, detail: result.detail, ok: result.ok })

        // The model needs to know whether its own action worked.
        transcript.push({
          id: `result-${step}`,
          role: 'user',
          content: result.ok ? `Result: ${result.detail}` : `That failed: ${result.detail}`,
          createdAt: Date.now()
        })

        if (step === MAX_AGENT_STEPS - 1) {
          appendStep({
            action: 'limit',
            detail: `Stopped after ${MAX_AGENT_STEPS} steps.`,
            ok: false
          })
          setRunState('stopped')
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setRunState('error')
    } finally {
      send('agent:stop', { tabId })
    }
  }, [activeTab, provider, modelId, goal, theme.colors.accent, ask, appendStep])

  const busy = runState === 'thinking' || runState === 'acting'

  if (usableProviders.length === 0) {
    return (
      <div className="rx-chat">
        <div className="rx-faint">
          The agent needs a model. Every provider is listed in Settings — paste a key into one.
        </div>
      </div>
    )
  }

  return (
    <div className="rx-chat">
      <div style={{ flex: 'none' }}>
        <ModelPicker providerId={providerId} modelId={modelId} onChange={select} disabled={busy} />
      </div>

      <div className="rx-agent-banner">
        <span className="rx-agent-dot" data-busy={busy ? 'true' : 'false'} />
        <span className="rx-faint">
          {busy
            ? runState === 'thinking'
              ? 'Reading the page…'
              : 'Acting — watch the cursor'
            : 'Its cursor appears on the page while it works. Stop any time.'}
        </span>
      </div>

      <div className="rx-chat-log" ref={logRef}>
        {steps.length === 0 && !busy ? (
          <div className="rx-faint">
            Give it something to do on this page — “find the pricing and tell me the cheapest plan”,
            “fill in the search box with my query”.
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {steps.map((step, index) => (
            <motion.div
              key={step.id}
              className="rx-agent-step"
              data-ok={step.ok ? 'true' : 'false'}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...tween('fast'), delay: stagger(Math.min(index, 6)) }}
            >
              <span className="rx-agent-step-kind">{step.action}</span>
              <span className="rx-message-body">{step.detail}</span>
            </motion.div>
          ))}
        </AnimatePresence>

        {busy ? (
          <motion.div
            className="rx-faint"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.6 }}
          >
            working…
          </motion.div>
        ) : null}

        {error ? <div className="rx-danger">{error}</div> : null}
      </div>

      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
        <textarea
          className="rx-textarea"
          value={goal}
          disabled={busy}
          placeholder="What should it do on this page?"
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void run()
            }
          }}
        />
        <div className="rx-row-between">
          <span className="rx-faint">
            {steps.length > 0 ? `${steps.length} of ${MAX_AGENT_STEPS} steps` : 'Never enters credentials'}
          </span>
          {busy ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" disabled={!goal.trim() || !activeTab} onClick={() => void run()}>
              Start
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
