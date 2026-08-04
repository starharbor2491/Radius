import type { ChatMessage } from '@shared/types'

/**
 * Puts a transcript into the shape chat templates expect.
 *
 * Plenty of models -- most of the Mistral and Llama families, and anything
 * served through a Jinja chat template -- do not merely prefer alternating
 * roles, they *raise* on anything else:
 *
 *   Error: Jinja Exception: After the optional system message, conversation
 *   roles must alternate user and assistant roles
 *
 * That is a 500 from the server with no hint about which message was wrong, so
 * it is worth never sending one. Radius produced them routinely: the agent
 * loop sends the result of an action and then the new page map as two separate
 * user turns, and the chat panel leaves a user turn with no reply behind when a
 * request fails, so the next question is a second user message in a row.
 *
 * Normalising here rather than in each caller means one place to be correct,
 * and it covers the adapters equally -- the OpenAI-compatible tier points at
 * whatever endpoint the user configured, so we cannot know how strict the thing
 * on the other end is.
 *
 * Four rules, in order:
 *
 *  1. Empty messages are dropped. They carry nothing and some templates count
 *     them when checking alternation.
 *  2. System messages are merged into one and hoisted to the front. A template
 *     that accepts a system message accepts it there; several accept it only
 *     there.
 *  3. Consecutive same-role messages are merged, joined by a blank line. The
 *     content is what matters to the model, and two user turns in a row say the
 *     same thing as one turn containing both.
 *  4. The conversation begins with a user message. An assistant turn first has
 *     nothing to answer, and templates reject it.
 */
export function normaliseForChatTemplate(messages: ChatMessage[]): ChatMessage[] {
  const substantive = messages.filter((message) => message.content.trim().length > 0)

  const system = substantive.filter((message) => message.role === 'system')
  const turns = substantive.filter((message) => message.role !== 'system')

  const merged: ChatMessage[] = []
  for (const message of turns) {
    const previous = merged[merged.length - 1]
    if (previous && previous.role === message.role) {
      // Keep the earlier message's identity: it is the one the transcript in
      // the renderer already knows about.
      merged[merged.length - 1] = {
        ...previous,
        content: `${previous.content}\n\n${message.content}`
      }
      continue
    }
    merged.push(message)
  }

  // An assistant message with nothing before it has nothing to be a reply to.
  while (merged.length > 0 && merged[0]!.role === 'assistant') merged.shift()

  if (system.length === 0) return merged

  const preamble: ChatMessage = {
    ...system[0]!,
    content: system.map((message) => message.content).join('\n\n')
  }
  return [preamble, ...merged]
}
