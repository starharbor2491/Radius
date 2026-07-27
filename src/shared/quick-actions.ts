/**
 * One-tap AI actions over the current page.
 *
 * These are the difference between "there is a chat panel in my browser" and
 * "the browser can do something with what I am looking at". Each is just a
 * prompt plus a context requirement, so they run through the same provider
 * layer and streaming path as ordinary chat -- there is no second code path to
 * keep working.
 */

export interface QuickAction {
  id: string
  label: string
  /** Short description shown in the palette and on hover. */
  hint: string
  icon: string
  /** What the action needs in order to be useful. */
  needs: 'page' | 'selection'
  /** Rendered into a user turn, with the page context attached separately. */
  prompt: (input: { title: string; url: string; selection: string }) => string
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'summarize',
    label: 'Summarize page',
    hint: 'Key points from this page',
    icon: '≡',
    needs: 'page',
    prompt: ({ title }) =>
      `Summarize the page "${title}" in at most six bullet points. ` +
      `Lead with what it is actually about, not what section headings exist. ` +
      `If the page is mostly navigation or boilerplate, say so instead of inventing a summary.`
  },
  {
    id: 'keypoints',
    label: 'Extract key facts',
    hint: 'Names, numbers, dates worth keeping',
    icon: '◆',
    needs: 'page',
    prompt: () =>
      `List the concrete facts on this page worth remembering -- names, figures, dates, ` +
      `definitions. One per line, no commentary. Only include things actually stated on the page.`
  },
  {
    id: 'explain',
    label: 'Explain selection',
    hint: 'Plain-language explanation of the selected text',
    icon: '?',
    needs: 'selection',
    prompt: ({ selection }) =>
      `Explain this in plain language, assuming no background knowledge:\n\n${selection}`
  },
  {
    id: 'translate',
    label: 'Translate to English',
    hint: 'Translate the selection, or the page',
    icon: '⇄',
    needs: 'page',
    prompt: ({ selection }) =>
      selection
        ? `Translate the following into English. Keep the tone and formatting:\n\n${selection}`
        : `Translate the main body text of this page into English. Keep the structure.`
  },
  {
    id: 'simplify',
    label: 'Simplify',
    hint: 'Rewrite the selection more simply',
    icon: '◔',
    needs: 'selection',
    prompt: ({ selection }) =>
      `Rewrite this to be as clear and short as possible without losing meaning. ` +
      `Keep any specifics -- numbers, names, conditions -- exactly as they are:\n\n${selection}`
  },
  {
    id: 'critique',
    label: 'What is missing?',
    hint: 'Gaps, caveats and unstated assumptions',
    icon: '◑',
    needs: 'page',
    prompt: ({ title }) =>
      `Reading "${title}": what important context, caveats or counterpoints does this page ` +
      `leave out? Be specific and brief. If it is even-handed already, say so.`
  }
]

export function findQuickAction(id: string): QuickAction | undefined {
  return QUICK_ACTIONS.find((action) => action.id === id)
}
