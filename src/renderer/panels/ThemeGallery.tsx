import { useMemo, useState, type CSSProperties, type JSX } from 'react'
import {
  failingContrast,
  flattenThemeOverride,
  resolveThemeVars,
  type Theme
} from '@shared/theme'
import { useTheme } from '../theme/ThemeProvider'
import { part } from '../theme/parts'
import { Icon } from '../ui/Icon'
import { Button } from '../ui/primitives'

/**
 * A miniature of the chrome, painted with one theme's tokens.
 *
 * The trick is that `resolveThemeVars` is pure and its output is just custom
 * properties: setting them on this element rather than on `:root` renders a
 * second, complete theme inside the first one. Nothing here is a picture of a
 * theme -- it is the same token engine, scoped to a box, so a preset with a
 * denser scale previews denser and one with no blur previews flat.
 */
export function ThemePreview({ theme }: { theme: Theme }): JSX.Element {
  const vars = useMemo(() => resolveThemeVars(theme) as CSSProperties, [theme])
  return (
    <span className="rx-theme-preview" style={vars} aria-hidden="true">
      <span className="rx-theme-preview-rail">
        <span className="rx-theme-preview-chip" data-active="true" />
        <span className="rx-theme-preview-chip" />
        <span className="rx-theme-preview-chip" />
      </span>
      <span className="rx-theme-preview-body">
        <span className="rx-theme-preview-bar">
          <span className="rx-theme-preview-tab" data-active="true" />
          <span className="rx-theme-preview-tab" />
          <span className="rx-theme-preview-omnibox" />
        </span>
        <span className="rx-theme-preview-page">
          <span className="rx-theme-preview-line" />
          <span className="rx-theme-preview-line" data-short="true" />
          <span className="rx-theme-preview-button" />
        </span>
      </span>
    </span>
  )
}

/**
 * The theme gallery.
 *
 * Clicking a card applies it. Hovering does nothing.
 *
 * Hover *used* to repaint the whole window, on the theory that a 150px card
 * cannot tell you whether a theme is comfortable to read a tab strip in. It
 * could not: applying a theme rewrites every `--rx-*` custom property on the
 * root, which invalidates style for the entire chrome -- eleven cards, every
 * panel, every glass surface with its backdrop filter. Doing that on pointer
 * move made the gallery unusable, and a preview you have to fight through is
 * worse than no preview.
 *
 * What replaces it is cheaper and honest: the cards are real miniature chromes
 * rendered by the token engine, applying is one click, and the header keeps a
 * labelled way back to whatever was in use when the gallery opened. Leaving is
 * still free -- it is just a button rather than moving the mouse away.
 *
 * The cards show each preset as its author wrote it, not as this workspace
 * would render it: an override that repaints every card the same accent would
 * make the grid useless for choosing. The difference is stated under the grid.
 */
export function ThemeGallery(): JSX.Element {
  const {
    presets,
    baseTheme,
    workspaceOverride,
    applyTheme,
    applyPreset,
    scope,
    workspaceThemeId,
    setWorkspaceThemeId
  } = useTheme()

  // What was in use when the gallery opened. Captured once, deliberately.
  const [restorePoint] = useState<Theme>(() => baseTheme)
  const changed = useMemo(
    () => JSON.stringify(restorePoint) !== JSON.stringify(baseTheme),
    [restorePoint, baseTheme]
  )

  const activeId = scope === 'workspace' ? workspaceThemeId : baseTheme.id
  const overrideCount = flattenThemeOverride(workspaceOverride).length

  return (
    <section {...part('theme-gallery')}>
      <div className="rx-row-between rx-gallery-head">
        <span className="rx-section-title rx-gallery-title">Gallery</span>
        {changed || (scope === 'workspace' && workspaceThemeId) ? (
          <Button
            variant="outline"
            className="rx-gallery-revert"
            onClick={() => {
              if (scope === 'workspace') setWorkspaceThemeId(null)
              else applyTheme(restorePoint)
            }}
          >
            <Icon name="revert" size={13} />
            {scope === 'workspace' ? 'Follow global' : `Back to ${restorePoint.name}`}
          </Button>
        ) : null}
      </div>

      <div className="rx-gallery-grid">
        {presets.map((preset) => {
          const failing = failingContrast(preset)
          return (
            <button
              key={preset.id}
              type="button"
              className="rx-theme-card"
              data-active={preset.id === activeId ? 'true' : 'false'}
              title={preset.description}
              {...part('theme-card')}
              onClick={() => applyPreset(preset.id)}
            >
              <ThemePreview theme={preset} />
              <span className="rx-theme-card-meta">
                <span className="rx-theme-card-name">
                  {preset.name}
                  {preset.id === activeId ? <Icon name="check" size={12} /> : null}
                </span>
                <span className="rx-theme-card-note">{preset.description}</span>
                {failing.length > 0 ? (
                  <span className="rx-contrast-badge" data-state="fail">
                    <Icon name="alert" size={11} />
                    {failing.length} pair{failing.length === 1 ? '' : 's'} below AA
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      <span className="rx-faint rx-gallery-hint">
        {scope === 'workspace'
          ? 'Clicking pins a preset as this workspace’s base theme.'
          : 'Click a theme to apply it. You can come back to the one you had.'}
      </span>

      {/*
        A card shows the preset as its author wrote it. What you will actually
        get is that preset with this workspace's override still on top, so when
        those differ, say so rather than letting the cards quietly promise
        something they will not deliver.
      */}
      {overrideCount > 0 ? (
        <span className="rx-faint rx-gallery-hint">
          This workspace overrides {overrideCount} token{overrideCount === 1 ? '' : 's'}, which
          stays on top of whichever theme you pick.
        </span>
      ) : null}
    </section>
  )
}
