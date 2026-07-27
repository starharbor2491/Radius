import { readFile, writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type { StateStore } from '../state/StateStore'
import { parseTheme, type Theme } from '@shared/theme'
import { DEFAULT_THEME_ID, getPreset, THEME_PRESETS } from '@shared/theme-presets'

const SETTING_THEME = 'theme'

/**
 * Persists the active theme and moves theme documents on and off disk.
 *
 * Themes are plain JSON with every field optional, so an exported file stays
 * readable and a hand-written one only needs the tokens it actually changes.
 */
export class ThemeService {
  constructor(private readonly state: StateStore) {}

  get(): Theme {
    const stored = this.state.getSetting<unknown>(SETTING_THEME, null)
    if (stored) {
      // A theme written by an older build still parses -- unknown-but-absent
      // tokens fall back to defaults rather than throwing the user's setup away.
      const result = safeParse(stored)
      if (result) return result
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

  async importFromFile(): Promise<Theme | null> {
    const result = await dialog.showOpenDialog({
      title: 'Import a Radius theme',
      filters: [{ name: 'Radius theme', extensions: ['json'] }],
      properties: ['openFile']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null

    const raw = await readFile(path, 'utf8')
    const theme = parseTheme(JSON.parse(raw))
    this.set(theme)
    return theme
  }

  async exportToFile(theme: Theme): Promise<void> {
    const result = await dialog.showSaveDialog({
      title: 'Export theme',
      defaultPath: `${theme.id || 'radius'}.radius-theme.json`,
      filters: [{ name: 'Radius theme', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return
    await writeFile(result.filePath, `${JSON.stringify(theme, null, 2)}\n`, 'utf8')
  }
}

function safeParse(input: unknown): Theme | null {
  try {
    return parseTheme(input)
  } catch {
    return null
  }
}
