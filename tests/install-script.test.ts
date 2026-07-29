import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards on the macOS installer.
 *
 * These exist because a real install failed on a real Mac: the script had
 * `"$INSTALL_DIR..."` written with a Unicode ellipsis, and macOS's bash 3.2
 * decides variable-name characters with isalnum() one byte at a time. In a
 * non-UTF-8 locale the ellipsis's leading byte passes that test, so bash read
 * the name as INSTALL_DIR plus that byte, found it unset, and `set -u` killed
 * the install one line before it would have copied the app.
 *
 * `bash -n` does not catch it -- the script is syntactically valid. Only these
 * rules do.
 */

const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'install-mac.sh')
const script = readFileSync(SCRIPT_PATH, 'utf8')
const lines = script.split('\n')

describe('install-mac.sh', () => {
  it('contains no non-ASCII characters', () => {
    const offenders = lines
      .map((line, index) => ({ line, number: index + 1 }))
      // eslint-disable-next-line no-control-regex
      .filter(({ line }) => /[^\x00-\x7F]/.test(line))
      .map(({ line, number }) => `${number}: ${line.trim()}`)

    expect(offenders, 'macOS bash 3.2 mis-parses non-ASCII next to expansions').toEqual([])
  })

  it('braces every variable expansion', () => {
    // `${VAR}` cannot absorb a following byte into the name; `$VAR` can.
    const offenders: string[] = []

    lines.forEach((line, index) => {
      const withoutComment = line.replace(/^\s*#.*$/, '')
      // Bare `$NAME` not followed by `{`, and not a positional or special
      // parameter like $1, $?, $@.
      for (const match of withoutComment.matchAll(/\$(?!\{|\()[A-Za-z_][A-Za-z0-9_]*/g)) {
        offenders.push(`${index + 1}: ${match[0]} in ${line.trim()}`)
      }
    })

    expect(offenders).toEqual([])
  })

  it('is bash 3.2 compatible', () => {
    // Constructs macOS's bundled bash does not have.
    const banned: Array<[RegExp, string]> = [
      [/\bdeclare\s+-A\b/, 'associative arrays are bash 4+'],
      [/\bmapfile\b|\breadarray\b/, 'mapfile/readarray are bash 4+'],
      [/\$\{[A-Za-z_][A-Za-z0-9_]*\^\^/, '${var^^} is bash 4+'],
      [/\$\{[A-Za-z_][A-Za-z0-9_]*,,/, '${var,,} is bash 4+'],
      [/\bshopt\s+-s\s+globstar\b/, 'globstar is bash 4+'],
      [/\blocal\s+-n\b/, 'namerefs are bash 4.3+']
    ]

    for (const [pattern, reason] of banned) {
      expect(pattern.test(script), reason).toBe(false)
    }
  })

  it('fails fast and cleans up after itself', () => {
    expect(script).toMatch(/^#!\/bin\/bash$/m)
    expect(script).toContain('set -euo pipefail')
    // A temp directory that survives a failed run is litter in /var/folders.
    expect(script).toMatch(/trap cleanup EXIT/)
  })

  it('guards the platform, architecture and OS version before doing anything', () => {
    const guardRegion = script.slice(0, script.indexOf('try_download()'))
    expect(guardRegion).toContain('Darwin')
    expect(guardRegion).toMatch(/arm64/)
    expect(guardRegion).toMatch(/x86_64/)
    // Electron 43 writes LSMinimumSystemVersion 12.0 into the bundle.
    expect(guardRegion).toMatch(/-lt 12\b/)
  })

  it('ad-hoc signs the app', () => {
    // Apple Silicon will not execute an unsigned binary at all.
    expect(script).toMatch(/codesign --force --deep --sign -/)
  })

  it('clears quarantine on anything it downloads', () => {
    expect(script).toMatch(/xattr -dr com\.apple\.quarantine/)
  })

  it('only reaches for sudo when the install directory is not writable', () => {
    expect(script).toMatch(/if \[ ! -w "\$\{INSTALL_DIR\}" \]/)
    // No unconditional sudo anywhere.
    const unconditional = lines.filter(
      (line) => /^\s*sudo\s/.test(line) && !line.includes('sudo_prefix')
    )
    expect(unconditional).toEqual([])
  })

  it('shows build output when a step fails instead of swallowing it', () => {
    // The first version sent everything to /dev/null, which left a failed
    // install with nothing to go on.
    expect(script).toMatch(/tail -n 20/)
  })

  it('passes its behavioural harness', () => {
    // scripts/test-install.sh sources the installer with stubbed macOS tools
    // and checks what lands on disk. Static rules only catch the shapes someone
    // remembered to forbid; this catches the rest.
    const output = execFileSync('bash', [join(__dirname, '..', 'scripts', 'test-install.sh')], {
      encoding: 'utf8'
    })
    expect(output).toMatch(/0 failed/)
  })
})
