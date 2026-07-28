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
  /**
   * Name of an icon in the renderer's set, not a glyph.
   *
   * Typed as a string because this module is shared with main, which has no
   * business importing a React component. A test asserts every name here
   * resolves, so a typo still fails the build rather than rendering nothing.
   */
  icon: string
  /**
   * What the action needs in order to be useful.
   *
   * `workspace` pulls in every open tab rather than just the current one, which
   * is the difference between "summarise this" and "what did I have open".
   */
  needs: 'page' | 'selection' | 'workspace'
  /** Rendered into a user turn, with the page context attached separately. */
  prompt: (input: { title: string; url: string; selection: string }) => string
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'summarize',
    label: 'Summarize page',
    hint: 'Key points from this page',
    icon: 'list',
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
    icon: 'tag',
    needs: 'page',
    prompt: () =>
      `List the concrete facts on this page worth remembering -- names, figures, dates, ` +
      `definitions. One per line, no commentary. Only include things actually stated on the page.`
  },
  {
    id: 'explain',
    label: 'Explain selection',
    hint: 'Plain-language explanation of the selected text',
    icon: 'question',
    needs: 'selection',
    prompt: ({ selection }) =>
      `Explain this in plain language, assuming no background knowledge:\n\n${selection}`
  },
  {
    id: 'translate',
    label: 'Translate to English',
    hint: 'Translate the selection, or the page',
    icon: 'translate',
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
    icon: 'wand',
    needs: 'selection',
    prompt: ({ selection }) =>
      `Rewrite this to be as clear and short as possible without losing meaning. ` +
      `Keep any specifics -- numbers, names, conditions -- exactly as they are:\n\n${selection}`
  },
  {
    id: 'critique',
    label: 'What is missing?',
    hint: 'Gaps, caveats and unstated assumptions',
    icon: 'balance',
    needs: 'page',
    prompt: ({ title }) =>
      `Reading "${title}": what important context, caveats or counterpoints does this page ` +
      `leave out? Be specific and brief. If it is even-handed already, say so.`
  },

  /* --------------------------------------------- across the whole workspace */
  {
    id: 'workspace-summary',
    label: 'Summarize all tabs',
    hint: 'What is open across this workspace',
    icon: 'layers',
    needs: 'workspace',
    prompt: () =>
      `Below are all the pages currently open in this workspace. Give me a short summary of ` +
      `what I appear to be working on, then one line per page saying what it is. Group them if ` +
      `there is an obvious grouping. Ignore pages that are only navigation or boilerplate.`
  },
  {
    id: 'workspace-question',
    label: 'Ask across tabs',
    hint: 'Answer using every open tab',
    icon: 'search',
    needs: 'workspace',
    prompt: () =>
      `Answer using the open pages below. Cite which page each part of the answer came from by ` +
      `its title. If the pages do not contain the answer, say so rather than filling the gap ` +
      `from memory.`
  }
]

export function findQuickAction(id: string): QuickAction | undefined {
  return QUICK_ACTIONS.find((action) => action.id === id)
}
