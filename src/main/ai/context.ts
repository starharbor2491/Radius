import type { ChatMessage, PageContext } from '@shared/types'

/**
 * Prepends shared browser tabs as a single system message.
 *
 * One message rather than several so the model reads the tabs as a labelled
 * corpus, and so a user scrolling the transcript can see exactly what was
 * shared in one place.
 */
export function withContext(messages: ChatMessage[], contexts: PageContext[]): ChatMessage[] {
  if (contexts.length === 0) return messages

  const body = contexts
    .map((context, index) => {
      const selection = context.selection ? `\nSelected text:\n${context.selection}` : ''
      return [
        `<page index="${index + 1}" url="${context.url}" title="${context.title}">`,
        context.text,
        selection,
        '</page>'
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')

  const preamble: ChatMessage = {
    id: 'page-context',
    role: 'system',
    content:
      'The user has shared the following browser tabs with you. Refer to them when relevant, ' +
      'and say so plainly if the answer is not in them.\n\n' +
      body,
    createdAt: Date.now()
  }

  return [preamble, ...messages]
}
