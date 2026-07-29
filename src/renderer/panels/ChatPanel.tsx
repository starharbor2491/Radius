import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import type { ChatMessage } from '@shared/types'
import { displayHost } from '@shared/url'
import { QUICK_ACTIONS, type QuickAction } from '@shared/quick-actions'
import { useActiveTab, useWorkspaceTabs } from '../store/useAppStore'
import { bridge, send } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Icon, type IconName } from '../ui/Icon'
import { ModelPicker, useSelectableProviders, type ModelSelection } from '../ui/ModelPicker'
import { Button } from '../ui/primitives'

interface Draft {
  runId: string
  text: string
  /** Streamed thinking, where the provider exposes it. Never part of `text`. */
  reasoning: string
}

/**
 * Streaming chat against whichever provider is selected.
 *
 * The reply is assembled here from `ai:stream` deltas rather than awaited as a
 * whole, so the first token appears as soon as the provider emits it.
 */
export function ChatPanel(): JSX.Element {
  const tabs = useWorkspaceTabs()
  const activeTab = useActiveTab()
  const { spring, tween } = useMotionTokens()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [modelId, setModelId] = useState<string>('')
  const logRef = useRef<HTMLDivElement>(null)

  const usableProviders = useSelectableProviders()
  const provider = usableProviders.find((candidate) => candidate.id === providerId)

  const select = useCallback((selection: ModelSelection) => {
    setProviderId(selection.providerId)
    setModelId(selection.modelId)
  }, [])

  useEffect(() => {
    return bridge.on('ai:stream', (event) => {
      setDraft((current) => {
        if (!current || current.runId !== event.runId) return current
        if (event.type === 'delta') return { ...current, text: current.text + event.text }
        if (event.type === 'reasoning') {
          return { ...current, reasoning: current.reasoning + event.text }
        }
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
      } else if (event.type === 'notice') {
        // A fallback provider took over, or the budget has something to say.
        // Shown rather than swallowed: the user is owed the fact that the
        // answer came from somewhere other than what the dropdown says.
        setNotices((current) => [...current, event.message])
      }
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draft?.text])

  // The command palette can fire a quick action; the panel owns provider and
  // model selection, so it has to be what actually dispatches the run.
  useEffect(() => {
    const listener = (event: Event): void => {
      const actionId = (event as CustomEvent<string>).detail
      const action = QUICK_ACTIONS.find((candidate) => candidate.id === actionId)
      if (action) void runQuickAction(action)
    }
    window.addEventListener('radius:quick-action', listener)
    return () => window.removeEventListener('radius:quick-action', listener)
  })

  const contextTabs = tabs.filter((tab) => tab.inAiContext)

  /**
   * Sends a turn. Quick actions funnel through here too, so they inherit
   * streaming, cancellation and cost tracking rather than duplicating them.
   */
  const dispatch = (content: string, feature: string, extraContextTabIds: string[] = []): void => {
    if (!provider || !modelId || draft) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now()
    }
    const history = [...messages, userMessage]
    const runId = crypto.randomUUID()

    setMessages(history)
    setInput('')
    setError(null)
    setNotices([])
    setDraft({ runId, text: '', reasoning: '' })

    send('ai:send', {
      runId,
      providerId: provider.id,
      modelId,
      messages: history,
      contextTabIds: [...new Set([...contextTabs.map((tab) => tab.id), ...extraContextTabIds])],
      feature
    })
  }

  const submit = (): void => {
    const trimmed = input.trim()
    if (trimmed) dispatch(trimmed, 'chat')
  }

  /**
   * Runs a quick action against the active tab.
   *
   * The page is added to context for this turn regardless of the sidebar
   * toggles -- "summarize this page" that ignores the page would be useless.
   */
  const runQuickAction = async (action: QuickAction): Promise<void> => {
    if (!activeTab) return
    const context = await bridge.invoke('page:getContext', { tabId: activeTab.id })

    if (action.needs === 'selection' && !context.selection) {
      setError('Select some text on the page first.')
      return
    }

    // A workspace action is about everything open, not the page in front of you,
    // so it pulls in every tab in the workspace rather than just the active one.
    const extraTabIds =
      action.needs === 'workspace' ? tabs.map((tab) => tab.id) : [activeTab.id]

    dispatch(
      action.prompt({
        title: context.title || activeTab.title,
        url: context.url,
        selection: context.selection
      }),
      action.id,
      extraTabIds
    )
  }

  if (usableProviders.length === 0) {
    return (
      <div className="rx-chat">
        <div className="rx-empty">
          <Icon name="key" size={20} />
          <p className="rx-empty-title">No model is reachable yet</p>
          <p>
            Every provider is listed in Settings — paste a key into any one of them and it becomes
            available here. Radius discovers its models for you.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rx-chat">
      <div style={{ flex: 'none' }}>
        <ModelPicker providerId={providerId} modelId={modelId} onChange={select} />
      </div>

      {/*
        Two rows of pills that used to look identical. They are not the same
        kind of thing: one is a toggle over what the model can see, the other
        fires a request. Labelling them and styling them apart is the whole fix.
      */}
      <div className="rx-chat-context">
        <div className="rx-section-title">
          Context
          <span className="rx-faint">
            {contextTabs.length > 0 ? `${contextTabs.length} of ${tabs.length}` : 'none'}
          </span>
        </div>
        <div className="rx-chip-row">
          {tabs.slice(0, 8).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="rx-context-chip"
              data-on={tab.inAiContext ? 'true' : 'false'}
              title={tab.url}
              aria-pressed={tab.inAiContext}
              onClick={() =>
                send('tabs:setAiContext', { tabId: tab.id, inContext: !tab.inAiContext })
              }
            >
              <Icon name={tab.inAiContext ? 'check' : 'plus'} size={11} />
              <span className="rx-chip-label">
                {tab.title || displayHost(tab.url) || 'New tab'}
              </span>
            </button>
          ))}
          {tabs.length > 8 ? <span className="rx-faint">+{tabs.length - 8} more</span> : null}
        </div>
      </div>

      <div className="rx-chat-context">
        <div className="rx-section-title">Do something with this page</div>
        <div className="rx-quick-actions">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className="rx-quick-action"
              title={action.hint}
              disabled={!activeTab || Boolean(draft)}
              onClick={() => void runQuickAction(action)}
            >
              <Icon name={action.icon as IconName} size={14} />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rx-chat-log" ref={logRef}>
        {messages.length === 0 && !draft ? (
          <div className="rx-empty">
            <Icon name="sparkle" size={20} />
            <p className="rx-empty-title">Ask about what you are looking at</p>
            <p>
              The page you are on is not shared until you add it. Tap a tab under
              <strong> Context</strong>, or run one of the actions above.
            </p>
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
            {draft.reasoning ? (
              <details className="rx-reasoning">
                <summary>
                  <Icon name="sparkle" size={12} />
                  {draft.text ? 'Thought before answering' : 'Thinking…'}
                </summary>
                <div className="rx-message-body">{draft.reasoning}</div>
              </details>
            ) : null}
            <div className="rx-message-body">
              {draft.text}
              <span className="rx-caret" />
            </div>
          </motion.div>
        ) : null}

        {notices.map((notice, index) => (
          <div key={`${index}-${notice}`} className="rx-notice">
            {notice}
          </div>
        ))}

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
