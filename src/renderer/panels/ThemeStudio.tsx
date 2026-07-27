import { useState, type JSX } from 'react'
import type { GlassSurfaceName } from '@shared/theme'
import { GlassModeSchema } from '@shared/theme'
import { checkContrast, formatOklch, parseOklch, toHex } from '@shared/color'
import { useTheme } from '../theme/ThemeProvider'
import { send } from '../lib/bridge'
import { Button, Field, Slider } from '../ui/primitives'

const SURFACES: GlassSurfaceName[] = ['chrome', 'panel', 'popover', 'overlay']
const GLASS_MODES = GlassModeSchema.options

/**
 * Live token editing.
 *
 * Every control writes straight into the theme, which re-resolves to CSS
 * variables on the spot -- there is no apply button because there is nothing
 * to apply. That immediacy is the point of the token engine.
 */
export function ThemeStudio(): JSX.Element {
  const { theme, presets, update, applyPreset } = useTheme()
  const [surface, setSurface] = useState<GlassSurfaceName>('chrome')
  const glass = theme.glass[surface]

  const contrast = checkContrast(theme.colors.text, theme.colors.surface1)

  return (
    <div className="rx-panel-scroll">
      <section>
        <div className="rx-section-title">Presets</div>
        <div className="rx-swatch-grid">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="rx-preset"
              data-active={preset.id === theme.id ? 'true' : 'false'}
              onClick={() => applyPreset(preset.id)}
            >
              <span className="rx-preset-swatches">
                {[preset.colors.bg, preset.colors.surface2, preset.colors.accent].map((color) => (
                  <span key={color} className="rx-preset-swatch" style={{ background: color }} />
                ))}
              </span>
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="rx-section-title">Colour</div>
        <div className="rx-card">
          <OklchControl
            label="Accent"
            value={theme.colors.accent}
            onChange={(accent) => update({ colors: { accent } })}
          />
          <OklchControl
            label="Background"
            value={theme.colors.bg}
            onChange={(bg) => update({ colors: { bg } })}
          />
          <OklchControl
            label="Text"
            value={theme.colors.text}
            onChange={(text) => update({ colors: { text } })}
          />
          {contrast ? (
            <span className={contrast.grade === 'fail' ? 'rx-danger' : 'rx-muted'}>
              Text on surface: {contrast.ratio}:1 ({contrast.grade})
            </span>
          ) : null}
          <Field label="Scheme">
            <select
              className="rx-input"
              value={theme.colors.scheme}
              onChange={(event) =>
                update({ colors: { scheme: event.target.value as 'dark' | 'light' } })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
        </div>
      </section>

      <section>
        <div className="rx-section-title">Glass</div>
        <div className="rx-card">
          <Field label="Surface">
            <select
              className="rx-input"
              value={surface}
              onChange={(event) => setSurface(event.target.value as GlassSurfaceName)}
            >
              {SURFACES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mode">
            <select
              className="rx-input"
              value={glass.mode}
              onChange={(event) =>
                update({ glass: { [surface]: { mode: event.target.value } } as never })
              }
            >
              {GLASS_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>

          <Slider
            label="Blur"
            suffix="px"
            min={0}
            max={120}
            value={glass.blur}
            onChange={(blur) => update({ glass: { [surface]: { blur } } as never })}
          />
          <Slider
            label="Saturation"
            min={0}
            max={4}
            step={0.05}
            value={glass.saturation}
            onChange={(saturation) => update({ glass: { [surface]: { saturation } } as never })}
          />
          <Slider
            label="Tint opacity"
            min={0}
            max={1}
            step={0.01}
            value={glass.tintAlpha}
            onChange={(tintAlpha) => update({ glass: { [surface]: { tintAlpha } } as never })}
          />
          <Slider
            label="Grain"
            min={0}
            max={0.3}
            step={0.005}
            value={glass.noise}
            onChange={(noise) => update({ glass: { [surface]: { noise } } as never })}
          />
          <Slider
            label="Edge light"
            min={0}
            max={1}
            step={0.01}
            value={glass.borderAlpha}
            onChange={(borderAlpha) => update({ glass: { [surface]: { borderAlpha } } as never })}
          />
        </div>
      </section>

      <section>
        <div className="rx-section-title">Shape</div>
        <div className="rx-card">
          <Slider
            label="Corner radius"
            suffix="px"
            min={0}
            max={32}
            value={theme.geometry.radiusMd}
            onChange={(radiusMd) =>
              update({ geometry: { radiusMd, radiusLg: radiusMd + 6, radiusXl: radiusMd + 14 } })
            }
          />
          <Slider
            label="Page inset"
            suffix="px"
            min={0}
            max={40}
            value={theme.geometry.pageInset}
            onChange={(pageInset) => {
              update({ geometry: { pageInset } })
              send('chrome:setPageShape', { inset: pageInset, radius: theme.geometry.pageRadius })
            }}
          />
          <Slider
            label="Page corner radius"
            suffix="px"
            min={0}
            max={40}
            value={theme.geometry.pageRadius}
            onChange={(pageRadius) => {
              update({ geometry: { pageRadius } })
              send('chrome:setPageShape', { inset: theme.geometry.pageInset, radius: pageRadius })
            }}
          />
          <Field label="Density">
            <select
              className="rx-input"
              value={theme.geometry.density}
              onChange={(event) =>
                update({ geometry: { density: event.target.value as 'compact' | 'normal' | 'comfortable' } })
              }
            >
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </Field>
          <Slider
            label="Base text size"
            suffix="px"
            min={10}
            max={20}
            step={0.5}
            value={theme.typography.baseSize}
            onChange={(baseSize) => update({ typography: { baseSize } })}
          />
        </div>
      </section>

      <section>
        <div className="rx-section-title">Motion</div>
        <div className="rx-card">
          <div className="rx-row-between">
            <span className="rx-label" style={{ marginBottom: 0 }}>
              Animations
            </span>
            <input
              type="checkbox"
              checked={theme.motion.enabled}
              onChange={(event) => update({ motion: { enabled: event.target.checked } })}
            />
          </div>
          <Slider
            label="Speed"
            suffix="×"
            min={0.3}
            max={2.5}
            step={0.05}
            value={theme.motion.scale}
            onChange={(scale) => update({ motion: { scale } })}
          />
          <Slider
            label="Tab drag stiffness"
            min={100}
            max={1200}
            step={10}
            value={theme.motion.springs.tabDrag.stiffness}
            onChange={(stiffness) => update({ motion: { springs: { tabDrag: { stiffness } } } })}
          />
          <Slider
            label="Tab drag damping"
            min={5}
            max={80}
            value={theme.motion.springs.tabDrag.damping}
            onChange={(damping) => update({ motion: { springs: { tabDrag: { damping } } } })}
          />
          <Slider
            label="Stagger"
            suffix="s"
            min={0}
            max={0.12}
            step={0.002}
            value={theme.motion.stagger}
            onChange={(stagger) => update({ motion: { stagger } })}
          />
        </div>
      </section>

      <section>
        <div className="rx-section-title">User CSS</div>
        <div className="rx-card">
          <textarea
            className="rx-textarea"
            style={{ minHeight: 120, fontFamily: 'var(--rx-font-mono)' }}
            value={theme.userCss}
            placeholder={'.rx-tab { text-transform: uppercase; }'}
            onChange={(event) => update({ userCss: event.target.value })}
          />
          <span className="rx-faint">
            Applies to the chrome only. Class names beginning <code>rx-</code> are the stable
            contract.
          </span>
        </div>
      </section>

      <div className="rx-row">
        <Button variant="outline" onClick={() => send('theme:exportFile', { theme })}>
          Export…
        </Button>
        <Button variant="outline" onClick={() => send('theme:importFile', {})}>
          Import…
        </Button>
      </div>
    </div>
  )
}

/**
 * Editing OKLCH directly rather than through a hex picker: lightness and chroma
 * are separable here, so dragging one does not silently change the others.
 */
function OklchControl({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  const parsed = parseOklch(value)
  if (!parsed) {
    return (
      <Field label={label}>
        <input className="rx-input" value={value} onChange={(event) => onChange(event.target.value)} />
      </Field>
    )
  }

  return (
    <div className="rx-field">
      <div className="rx-row-between">
        <span className="rx-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <span
          className="rx-preset-swatch"
          style={{ background: value, width: 20, height: 20 }}
          title={toHex(parsed)}
        />
      </div>
      <Slider
        label="Lightness"
        min={0}
        max={1}
        step={0.01}
        value={parsed.l}
        onChange={(l) => onChange(formatOklch({ ...parsed, l }))}
      />
      <Slider
        label="Chroma"
        min={0}
        max={0.37}
        step={0.005}
        value={parsed.c}
        onChange={(c) => onChange(formatOklch({ ...parsed, c }))}
      />
      <Slider
        label="Hue"
        suffix="°"
        min={0}
        max={360}
        value={parsed.h}
        onChange={(h) => onChange(formatOklch({ ...parsed, h }))}
      />
    </div>
  )
}
