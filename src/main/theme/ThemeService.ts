import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog } from 'electron'
import type { StateStore } from '../state/StateStore'
import {
  flattenThemeOverride,
  parseTheme,
  parseThemeDocument,
  type Theme,
  type ThemeImportResult
} from '@shared/theme'
import { DEFAULT_THEME_ID, getPreset, THEME_PRESETS } from '@shared/theme-presets'

const SETTING_THEME = 'theme'

export const THEME_FILE_SUFFIX = '.radius-theme.json'

/**
 * Persists the active theme and moves theme documents on and off disk.
 *
 * Themes are plain JSON with every field optional, so an exported file stays
 * readable and a hand-written one only needs the tokens it actually changes.
 * File dialogs are a main-process capability, so both directions live here and
 * the renderer only ever sees a result object.
 */
export class ThemeService {
  constructor(private readonly state: StateStore) {}

  get(): Theme {
    const stored = this.state.getSetting<unknown>(SETTING_THEME, null)
    if (stored) {
      // A theme written by an older build still parses -- unknown-but-absent
      // tokens fall back to defaults rather than throwing the user's setup away.
      const result = parseThemeDocument(stored)
      if (result.ok) return result.theme
    }
    return getPreset(DEFAULT_THEME_ID) ?? parseTheme({})
  }

  set(theme: Theme): void {
    this.state.setSetting(SETTING_THEME, theme)
    this.state.notify()
  }

  presets(): Theme[] {
    return THEME_PRESETS
  }

  /**
   * Reads a theme file and reports what happened.
   *
   * Deliberately does *not* apply the theme: the renderer holds the "what was
   * in use before" that the gallery's revert button needs, so importing is a
   * read, and applying is the same `theme:set` any other edit takes.
   */
  async importFromFile(): Promise<ThemeImportResult> {
    const result = await dialog.showOpenDialog({
      title: 'Import a Radius theme',
      filters: [{ name: 'Radius theme', extensions: ['json'] }],
      properties: ['openFile']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return blank('cancelled')

    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      return { ...blank('failed'), path, error: `Could not read ${basename(path)}: ${reason(error)}` }
    }

    let document: unknown
    try {
      document = JSON.parse(raw)
    } catch (error) {
      // A JSON syntax error already names the offset; passing it through is
      // more useful than "invalid file".
      return { ...blank('failed'), path, error: `${basename(path)} is not valid JSON: ${reason(error)}` }
    }

    const parsed = parseThemeDocument(document)
    if (!parsed.ok) {
      return { ...blank('failed'), path, issues: parsed.issues }
    }

    return {
      status: 'imported',
      theme: parsed.theme,
      path,
      // What the *file* named, not what the schema filled in: a three-line theme
      // should report three tokens, not the ninety it resolved to.
      setPaths: flattenThemeOverride(document as Record<string, unknown>).map((leaf) => leaf.path),
      issues: [],
      error: ''
    }
  }

  async exportToFile(theme: Theme): Promise<{ saved: boolean; path: string | null }> {
    const result = await dialog.showSaveDialog({
      title: 'Export theme',
      defaultPath: `${slug(theme.name) || theme.id || 'radius'}${THEME_FILE_SUFFIX}`,
      filters: [{ name: 'Radius theme', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    await writeFile(result.filePath, `${JSON.stringify(theme, null, 2)}\n`, 'utf8')
    return { saved: true, path: result.filePath }
  }
}

function blank(status: ThemeImportResult['status']): ThemeImportResult {
  return { status, theme: null, path: null, setPaths: [], issues: [], error: '' }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
