import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import type { ChatMessage } from '@shared/types'
import { displayHost } from '@shared/url'
import { useActiveTab, useAppStore, useWorkspaceTabs } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Button } from '../ui/primitives'

interface Draft {
  runId: string
  text: string
}

/**
 * Streaming chat against whichever provider is selected.
 *
 * The reply is assembled here from `ai:stream` deltas rather than awaited as a
 * whole, so the first token appears as soon as the provider emits it.
 */
export function ChatPanel(): JSX.Element {
  const providers = useAppStore((store) => store.state.providers)
  const tabs = useWorkspaceTabs()
  const activeTab = useActiveTab()
  const { spring, tween } = useMotionTokens()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providerId, setProviderId] = useState<string>('')
  const [modelId, setModelId] = useState<string>('')
  const logRef = useRef<HTMLDivElement>(null)

  const usableProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.models.length > 0),
    [providers]
  )
  const provider = usableProviders.find((candidate) => candidate.id === providerId)

  // Settle on a sensible default provider/model as soon as one is configured.
  useEffect(() => {
    if (!provider && usableProviders.length > 0) {
      const preferred = usableProviders.find((candidate) => candidate.hasKey) ?? usableProviders[0]!
      setProviderId(preferred.id)
      setModelId(preferred.models[0]?.id ?? '')
    }
  }, [provider, usableProviders])

  useEffect(() => {
    if (provider && !provider.models.some((model) => model.id === modelId)) {
      setModelId(provider.models[0]?.id ?? '')
    }
  }, [provider, modelId])

  useEffect(() => {
    return bridge.on('ai:stream', (event) => {
      setDraft((current) => {
        if (!current || current.runId !== event.runId) return current
        if (event.type === 'delta') return { ...current, text: current.text + event.text }
        return current
      })

      if (event.type === 'done') {
        setDraft((current) => {
          if (!current || current.runId !== event.runId) return current
          if (current.text) {
            setMessages((history) => [
              ...history,
              { id: current.runId, role: 'assistant', content: current.text, createdAt: Date.now() }
            ])
          }
          return null
        })
      } else if (event.type === 'error') {
        setError(event.message)
        setDraft(null)
      }
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draft?.text])

  const contextTabs = tabs.filter((tab) => tab.inAiContext)

  const submit = (): void => {
    const trimmed = input.trim()
    if (!trimmed || !provider || !modelId || draft) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now()
    }
    const history = [...messages, userMessage]
    const runId = crypto.randomUUID()

    setMessages(history)
    setInput('')
    setError(null)
    setDraft({ runId, text: '' })

    send('ai:send', {
      runId,
      providerId: provider.id,
      modelId,
      messages: history,
      contextTabIds: contextTabs.map((tab) => tab.id),
      feature: 'chat'
    })
  }

  if (usableProviders.length === 0) {
    return (
      <div className="rx-chat">
        <div className="rx-faint">
          No provider has any models yet. Open Settings, add an API key, and run Discover models.
        </div>
      </div>
    )
  }

  return (
    <div className="rx-chat">
      <div className="rx-row" style={{ flex: 'none' }}>
        <select
          className="rx-input"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          {usableProviders.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
              {candidate.hasKey ? '' : ' (no key)'}
            </option>
          ))}
        </select>
        <select className="rx-input" value={modelId} onChange={(event) => setModelId(event.target.value)}>
          {(provider?.models ?? []).map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rx-row" style={{ flex: 'none', flexWrap: 'wrap', gap: 4 }}>
        {tabs.slice(0, 8).map((tab) => (
          <span
            key={tab.id}
            className="rx-context-chip"
            data-on={tab.inAiContext ? 'true' : 'false'}
            title={tab.url}
            onClick={() => send('tabs:setAiContext', { tabId: tab.id, inContext: !tab.inAiContext })}
          >
            {tab.inAiContext ? '✦' : '＋'} {tab.title || displayHost(tab.url) || 'New tab'}
          </span>
        ))}
        {activeTab && !activeTab.inAiContext ? null : null}
      </div>

      <div className="rx-chat-log" ref={logRef}>
        {messages.length === 0 && !draft ? (
          <div className="rx-faint">
            Ask about the page, or tap a tab above to put it in context.
          </div>
        ) : null}

        {messages.map((message) => (
          <motion.div
            key={message.id}
            className="rx-message"
            data-role={message.role}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring('panel')}
          >
            <span className="rx-message-role">{message.role}</span>
            <div className="rx-message-body">{message.content}</div>
          </motion.div>
        ))}

        {draft ? (
          <motion.div
            className="rx-message"
            data-role="assistant"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={tween('fast')}
          >
            <span className="rx-message-role">assistant</span>
            <div className="rx-message-body">
              {draft.text}
              <span className="rx-caret" />
            </div>
          </motion.div>
        ) : null}

        {error ? <div className="rx-danger">{error}</div> : null}
      </div>

      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
        <textarea
          className="rx-textarea"
          value={input}
          placeholder="Ask anything…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="rx-row-between">
          <span className="rx-faint">
            {contextTabs.length > 0 ? `${contextTabs.length} tab(s) in context` : 'No page context'}
          </span>
          {draft ? (
            <Button variant="outline" onClick={() => send('ai:cancel', { runId: draft.runId })}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={submit} disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
