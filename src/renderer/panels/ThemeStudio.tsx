import { useMemo, useState, type JSX } from 'react'
import type { ContrastFinding, GlassSurfaceName, ThemeImportResult } from '@shared/theme'
import {
  auditThemeContrast,
  flattenThemeOverride,
  GlassModeSchema,
  withoutThemeOverridePath
} from '@shared/theme'
import { formatOklch, parseOklch, toHex } from '@shared/color'
import { useTheme, type ThemeScope } from '../theme/ThemeProvider'
import { part, RADIUS_PARTS } from '../theme/parts'
import { bridge } from '../lib/bridge'
import { Button, Field, Slider } from '../ui/primitives'
import { Icon } from '../ui/Icon'
import { ThemeGallery } from './ThemeGallery'

const SURFACES: GlassSurfaceName[] = ['chrome', 'panel', 'popover', 'overlay']
const GLASS_MODES = GlassModeSchema.options

/**
 * Live token editing.
 *
 * Every control writes straight into the theme, which re-resolves to CSS
 * variables on the spot -- there is no apply button because there is nothing
 * to apply. That immediacy is the point of the token engine.
 *
 * The one thing a control has to be explicit about is *where* the write lands:
 * the scope switch at the top decides whether an edit changes the theme itself
 * or only this workspace's override of it.
 */
export function ThemeStudio(): JSX.Element {
  const {
    theme,
    presets,
    update,
    applyTheme,
    scope,
    setScope,
    canEditWorkspace,
    workspaceOverride,
    setWorkspaceOverride,
    workspaceThemeId,
    setWorkspaceThemeId,
    overrideIssues,
    userCssWarnings
  } = useTheme()
  const [surface, setSurface] = useState<GlassSurfaceName>('chrome')
  const [report, setReport] = useState<ThemeImportResult | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const glass = theme.glass[surface]

  const findings = useMemo(() => {
    const audit = auditThemeContrast(theme)
    return Object.fromEntries(audit.map((finding) => [finding.id, finding]))
  }, [theme])

  const overrideLeaves = useMemo(
    () => flattenThemeOverride(workspaceOverride),
    [workspaceOverride]
  )

  const importTheme = async (): Promise<void> => {
    setExportNote(null)
    const result = await bridge.invoke('theme:importFile', {})
    if (result.status === 'cancelled') return
    setReport(result)
    if (result.status === 'imported' && result.theme) applyTheme(result.theme)
  }

  const exportTheme = async (): Promise<void> => {
    setReport(null)
    const result = await bridge.invoke('theme:exportFile', { theme })
    setExportNote(result.saved && result.path ? `Saved to ${result.path}` : null)
  }

  return (
    <div className="rx-panel-scroll">
      <ScopeSwitch scope={scope} setScope={setScope} canEditWorkspace={canEditWorkspace} />

      <ThemeGallery />

      <section>
        <div className="rx-section-title">Colour</div>
        <div className="rx-card">
          <OklchControl
            label="Accent"
            value={theme.colors.accent}
            onChange={(accent) => update({ colors: { accent } })}
            findings={[findings['accent-text'], findings['accent-surface']]}
          />
          <OklchControl
            label="Background"
            value={theme.colors.bg}
            onChange={(bg) => update({ colors: { bg } })}
            findings={[findings['text-bg']]}
          />
          <OklchControl
            label="Text"
            value={theme.colors.text}
            onChange={(text) => update({ colors: { text } })}
            findings={[findings['text-surface']]}
          />
          <OklchControl
            label="Muted text"
            value={theme.colors.textMuted}
            onChange={(textMuted) => update({ colors: { textMuted } })}
            findings={[findings['muted-surface']]}
          />
          <OklchControl
            label="Faint text"
            value={theme.colors.textFaint}
            onChange={(textFaint) => update({ colors: { textFaint } })}
            findings={[findings['faint-surface']]}
          />
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
          {/*
            The page view is moved by main, not by CSS. ThemeProvider watches the
            resolved geometry and pushes the shape, so these two only have to
            write tokens like every other control.
          */}
          <Slider
            label="Page inset"
            suffix="px"
            min={0}
            max={40}
            value={theme.geometry.pageInset}
            onChange={(pageInset) => update({ geometry: { pageInset } })}
          />
          <Slider
            label="Page corner radius"
            suffix="px"
            min={0}
            max={40}
            value={theme.geometry.pageRadius}
            onChange={(pageRadius) => update({ geometry: { pageRadius } })}
          />
          <Field label="Density">
            <select
              className="rx-input"
              value={theme.geometry.density}
              onChange={(event) =>
                update({
                  geometry: { density: event.target.value as 'compact' | 'normal' | 'comfortable' }
                })
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
            <span className="rx-label rx-label-inline">Animations</span>
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

      {/* ------------------------------------------------------ workspace */}
      <section>
        <div className="rx-section-title">This workspace</div>
        <div className="rx-card">
          {canEditWorkspace ? (
            <>
              <Field label="Base theme">
                <select
                  className="rx-input"
                  value={workspaceThemeId ?? ''}
                  onChange={(event) => setWorkspaceThemeId(event.target.value || null)}
                >
                  <option value="">Follow the global theme</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </Field>

              {overrideLeaves.length === 0 ? (
                <span className="rx-faint">
                  No overrides. Switch the scope above to “This workspace” and any control here
                  writes a token onto the workspace instead of the theme.
                </span>
              ) : (
                <>
                  <span className="rx-muted">
                    {overrideLeaves.length} token{overrideLeaves.length === 1 ? '' : 's'} overridden
                    here, merged over {workspaceThemeId ? 'the pinned preset' : 'the global theme'}.
                  </span>
                  <ul className="rx-override-list">
                    {overrideLeaves.map((leaf) => (
                      <li key={leaf.path} className="rx-override-row">
                        <code className="rx-override-path">{leaf.path}</code>
                        <span className="rx-override-value">{formatValue(leaf.value)}</span>
                        <button
                          type="button"
                          className="rx-override-drop"
                          aria-label={`Stop overriding ${leaf.path}`}
                          onClick={() =>
                            setWorkspaceOverride(
                              withoutThemeOverridePath(workspaceOverride ?? {}, leaf.path)
                            )
                          }
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" onClick={() => setWorkspaceOverride(null)}>
                    Clear this workspace’s overrides
                  </Button>
                </>
              )}

              {overrideIssues.length > 0 ? (
                <div className="rx-issue-list" data-state="fail">
                  <span className="rx-inline">
                    <Icon name="alert" size={12} />
                    This workspace’s override was ignored:
                  </span>
                  {overrideIssues.map((issue) => (
                    <span key={`${issue.path}:${issue.message}`} className="rx-issue">
                      <code>{issue.path}</code> {issue.message}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <span className="rx-faint">No workspace is active.</span>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- user CSS */}
      <section>
        <div className="rx-section-title">User CSS</div>
        <div className="rx-card">
          <textarea
            className="rx-textarea rx-css-editor"
            value={theme.userCss}
            spellCheck={false}
            placeholder={'[data-radius-part="tab"] { text-transform: uppercase; }'}
            onChange={(event) => update({ userCss: event.target.value })}
          />
          <span className="rx-faint">
            Injected into the chrome only — never into a page — and never evaluated as script.
            Aim at <code>data-radius-part</code>, which is a documented contract; class names are
            not.
          </span>
          {userCssWarnings.length > 0 ? (
            <div className="rx-issue-list" data-state="warn">
              {userCssWarnings.map((warning) => (
                <span key={warning} className="rx-inline rx-issue">
                  <Icon name="alert" size={12} />
                  {warning}
                </span>
              ))}
            </div>
          ) : null}
          <details className="rx-parts">
            <summary className="rx-muted">The {RADIUS_PARTS.length} parts you can target</summary>
            <div className="rx-parts-grid">
              {RADIUS_PARTS.map((name) => (
                <code key={name} className="rx-part-name">
                  {name}
                </code>
              ))}
            </div>
          </details>
        </div>
      </section>

      {/* --------------------------------------------------- import/export */}
      <section>
        <div className="rx-section-title">Theme file</div>
        <div className="rx-card">
          <div className="rx-row">
            <Button variant="outline" onClick={() => void exportTheme()}>
              Export…
            </Button>
            <Button variant="outline" onClick={() => void importTheme()}>
              Import…
            </Button>
          </div>
          <span className="rx-faint">
            Exports what is on screen, workspace overrides included. A file only needs the tokens
            it changes — everything else falls back to the defaults.
          </span>
          {exportNote ? <span className="rx-muted rx-path">{exportNote}</span> : null}
          {report ? <ImportReport report={report} /> : null}
        </div>
      </section>
    </div>
  )
}

/**
 * Where edits land.
 *
 * Worth a control of its own rather than a per-field toggle: the whole panel
 * changes meaning, and a user who does not know which document they are editing
 * will eventually be surprised by one of them.
 */
function ScopeSwitch({
  scope,
  setScope,
  canEditWorkspace
}: {
  scope: ThemeScope
  setScope: (scope: ThemeScope) => void
  canEditWorkspace: boolean
}): JSX.Element {
  const options: Array<{ id: ThemeScope; label: string }> = [
    { id: 'global', label: 'Global theme' },
    { id: 'workspace', label: 'This workspace' }
  ]
  return (
    <div className="rx-scope">
      <div className="rx-scope-switch" role="radiogroup" aria-label="Where edits are saved">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={scope === option.id}
            className="rx-scope-option"
            data-active={scope === option.id ? 'true' : 'false'}
            disabled={option.id === 'workspace' && !canEditWorkspace}
            onClick={() => setScope(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="rx-faint">
        {scope === 'global'
          ? 'Edits change the theme itself, for every workspace.'
          : 'Edits are stored on this workspace and merged over the theme.'}
      </span>
    </div>
  )
}

function ImportReport({ report }: { report: ThemeImportResult }): JSX.Element {
  const name = report.path ? report.path.split(/[\\/]/).pop() : 'the file'
  if (report.status === 'imported') {
    return (
      <div className="rx-issue-list" data-state="ok">
        <span className="rx-inline">
          <Icon name="check" size={12} />
          Imported {report.setPaths.length} token{report.setPaths.length === 1 ? '' : 's'} from{' '}
          {name}. Everything else fell back to the defaults.
        </span>
      </div>
    )
  }
  return (
    <div className="rx-issue-list" data-state="fail">
      <span className="rx-inline">
        <Icon name="alert" size={12} />
        {name} was not imported.
      </span>
      {report.error ? <span className="rx-issue">{report.error}</span> : null}
      {report.issues.map((issue) => (
        <span key={`${issue.path}:${issue.message}`} className="rx-issue">
          <code>{issue.path}</code> — {issue.message}
        </span>
      ))}
    </div>
  )
}

/**
 * Says what a colour pair actually measures.
 *
 * Deliberately not a correction: a user who wants a low-contrast theme gets
 * one. It is also deliberately not silent -- a failing pair reads as a failure
 * at the control that caused it, with the number and the rule it missed.
 */
function ContrastNote({ finding }: { finding: ContrastFinding | undefined }): JSX.Element | null {
  if (!finding) return null
  if (finding.ratio === null) {
    return (
      <span className="rx-contrast rx-inline" data-state="unknown">
        <Icon name="question" size={11} />
        {finding.label}: not measurable — contrast needs both colours in oklch().
      </span>
    )
  }
  return (
    <span className="rx-contrast rx-inline" data-state={finding.passes ? 'ok' : 'fail'}>
      {finding.passes ? null : <Icon name="alert" size={11} />}
      {finding.label}: {finding.ratio.toFixed(2)}:1{' '}
      {finding.passes
        ? `(${finding.grade})`
        : `— below ${finding.minimum}:1, the WCAG AA minimum for ${finding.reason}.`}
    </span>
  )
}

/**
 * Editing OKLCH directly rather than through a hex picker: lightness and chroma
 * are separable here, so dragging one does not silently change the others.
 */
function OklchControl({
  label,
  value,
  onChange,
  findings = []
}: {
  label: string
  value: string
  onChange: (value: string) => void
  findings?: Array<ContrastFinding | undefined>
}): JSX.Element {
  const parsed = parseOklch(value)
  const notes = findings.map((finding) =>
    finding ? <ContrastNote key={finding.id} finding={finding} /> : null
  )

  if (!parsed) {
    return (
      <div className="rx-field">
        <Field label={label}>
          <input
            className="rx-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
        {notes}
      </div>
    )
  }

  return (
    <div className="rx-field">
      <div className="rx-row-between">
        <span className="rx-label rx-label-inline">{label}</span>
        <span className="rx-swatch" style={{ background: value }} title={toHex(parsed)} />
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
      {notes}
    </div>
  )
}

function formatValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 28 ? `${text.slice(0, 27)}…` : text
}
