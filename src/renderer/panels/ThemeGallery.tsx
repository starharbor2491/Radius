import { useMemo, useState, type CSSProperties, type JSX } from 'react'
import { failingContrast, resolveThemeVars, type Theme } from '@shared/theme'
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
 * Hovering a card applies it to the whole chrome, because a 150px preview
 * cannot tell you whether a theme is comfortable to read a tab strip in.
 * Nothing is persisted until the card is clicked, and the header keeps a way
 * back to whatever was in use when the gallery was opened -- live preview is
 * only honest if leaving is free.
 */
export function ThemeGallery(): JSX.Element {
  const {
    presets,
    baseTheme,
    compose,
    applyTheme,
    applyPreset,
    previewTheme,
    previewing,
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

      <div className="rx-gallery-grid" onMouseLeave={() => previewTheme(null)}>
        {presets.map((preset) => {
          const composed = compose(preset)
          const failing = failingContrast(composed)
          return (
            <button
              key={preset.id}
              type="button"
              className="rx-theme-card"
              data-active={preset.id === activeId ? 'true' : 'false'}
              title={preset.description}
              {...part('theme-card')}
              onMouseEnter={() => previewTheme(preset)}
              onFocus={() => previewTheme(preset)}
              onBlur={() => previewTheme(null)}
              onClick={() => applyPreset(preset.id)}
            >
              <ThemePreview theme={composed} />
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
        {previewing
          ? 'Previewing. Nothing is saved until you click.'
          : scope === 'workspace'
            ? 'Clicking pins a preset as this workspace’s base theme.'
            : 'Hover to try a theme on the whole window; click to keep it.'}
      </span>
    </section>
  )
}
