import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_NAMES, ipcContract, ipcEvents, isIpcChannel } from '@shared/ipc'
import { ProviderManifestSchema } from '@shared/types'

describe('ipc contract', () => {
  it('every channel declares a request and response schema', () => {
    for (const channel of IPC_CHANNELS) {
      expect(ipcContract[channel].request, channel).toBeDefined()
      expect(ipcContract[channel].response, channel).toBeDefined()
    }
  })

  it('recognises only declared channels', () => {
    expect(isIpcChannel('tabs:create')).toBe(true)
    expect(isIpcChannel('tabs:definitely-not-real')).toBe(false)
    // Guards against a prototype-chain false positive.
    expect(isIpcChannel('toString')).toBe(false)
  })

  it('accepts a minimal payload and applies declared defaults', () => {
    const parsed = ipcContract['groups:create'].request.parse({ workspaceId: 'w1' })
    expect(parsed).toEqual({ workspaceId: 'w1', title: 'New group', color: 'blue', tabIds: [] })
  })

  it('rejects a payload with the wrong shape', () => {
    expect(() => ipcContract['tabs:close'].request.parse({})).toThrow()
    expect(() => ipcContract['tabs:setPinned'].request.parse({ tabId: 'x', pinned: 'yes' })).toThrow()
    expect(() => ipcContract['groups:create'].request.parse({ workspaceId: 'w', color: 'beige' })).toThrow()
  })

  it('rejects negative chrome insets', () => {
    expect(() =>
      ipcContract['chrome:setInsets'].request.parse({ top: -1, right: 0, bottom: 0, left: 0 })
    ).toThrow()
  })

  it('treats a missing payload as an empty object for no-arg channels', () => {
    expect(ipcContract['state:get'].request.parse({})).toEqual({})
  })

  it('requires a valid URL when adding an OpenAI-compatible provider', () => {
    expect(() =>
      ipcContract['ai:addOpenAiCompatible'].request.parse({ label: 'x', baseUrl: 'not a url' })
    ).toThrow()
    expect(
      ipcContract['ai:addOpenAiCompatible'].request.parse({
        label: 'x',
        baseUrl: 'http://localhost:11434/v1'
      }).models
    ).toEqual([])
  })
})

describe('ipc events', () => {
  it('the preload allowlist matches the declared events', () => {
    // src/preload/chrome.ts hardcodes this list because a sandboxed preload
    // cannot import zod. If they drift, events silently stop arriving.
    expect([...IPC_EVENT_NAMES].sort()).toEqual(
      ['ai:stream', 'command:invoke', 'state:changed'].sort()
    )
  })

  it('validates the ai stream union', () => {
    const schema = ipcEvents['ai:stream']
    expect(schema.parse({ runId: 'r', type: 'delta', text: 'hi' })).toBeTruthy()
    expect(schema.parse({ runId: 'r', type: 'done', usage: null })).toBeTruthy()
    expect(() => schema.parse({ runId: 'r', type: 'delta' })).toThrow()
    expect(() => schema.parse({ runId: 'r', type: 'nope' })).toThrow()
  })
})

describe('provider manifest schema', () => {
  it('fills the OpenAI-shaped defaults from a minimal manifest', () => {
    const manifest = ProviderManifestSchema.parse({
      endpoint: 'https://api.example.com/v1/chat',
      authStyle: 'bearer'
    })
    expect(manifest.modelField).toBe('model')
    expect(manifest.messagesField).toBe('messages')
    expect(manifest.streamFormat).toBe('sse')
    expect(manifest.deltaPath).toBe('choices.0.delta.content')
    expect(manifest.doneSentinel).toBe('[DONE]')
  })

  it('rejects a non-URL endpoint', () => {
    expect(() => ProviderManifestSchema.parse({ endpoint: 'ftp', authStyle: 'none' })).toThrow()
  })
})
