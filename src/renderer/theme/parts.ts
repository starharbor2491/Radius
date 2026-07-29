/**
 * The `data-radius-part` contract.
 *
 * User CSS is the one place a person hands Radius something free-form, and the
 * thing it needs to aim at is a stable name for a piece of the chrome. Class
 * names are not that: `rx-tab` is an implementation detail of the stylesheet and
 * a refactor is free to rename it. These attributes are the promise instead --
 * they are documented in ARCHITECTURE.md, they are covered by a test, and they
 * outlive the class names next to them.
 *
 * Adding a part is additive and cheap. Removing or renaming one is a breaking
 * change to every theme a user has written, so it needs the same care as
 * changing an IPC channel.
 */
export const RADIUS_PARTS = [
  /* structure */
  'shell',
  'sidebar',
  'workspace-rail',
  'workspace-chip',
  'tab-strip',
  'tab',
  'toolbar',
  'omnibox',
  'find-bar',
  'panel',
  'panel-header',
  'panel-title',
  'command-palette',
  /* controls */
  'button',
  'icon-button',
  'field',
  'field-label',
  'slider',
  'toast',
  /* surfaces */
  'glass',
  /* theming */
  'theme-gallery',
  'theme-card'
] as const

export type RadiusPart = (typeof RADIUS_PARTS)[number]

/**
 * Spread onto an element: `<div {...part('toolbar')}>`.
 *
 * A helper rather than a bare string so a typo is a build error, and so every
 * use site is greppable when the contract is being audited.
 */
export function part(name: RadiusPart): { 'data-radius-part': RadiusPart } {
  return { 'data-radius-part': name }
}
