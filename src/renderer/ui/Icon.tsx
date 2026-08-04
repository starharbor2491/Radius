import type { JSX, ReactNode, SVGProps } from 'react'

/**
 * The icon set.
 *
 * One inline SVG component instead of text glyphs, for three reasons: a glyph
 * renders at whatever weight and baseline the platform font happens to give it
 * (so ✕ and ⟳ never looked like they came from the same family), a missing
 * glyph falls back to tofu, and a glyph cannot inherit the accent colour on a
 * per-path basis.
 *
 * Every icon is drawn on the same 24x24 grid with the same stroke weight, so
 * they read as one set. Anything that needs a solid area (a filled star, a
 * palette dot) sets `fill` on that path only -- the root `<svg>` stays
 * `fill="none"` so unfilled paths cannot accidentally blob.
 */
const ICONS = {
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  back: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  forward: <path d="M9 5.5 15.5 12 9 18.5" />,
  reload: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
      <path d="M20.5 4.5v4.2h-4.2" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  star: <path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.88l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z" />,
  'star-filled': (
    <path
      fill="currentColor"
      d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.88l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z"
    />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.49-6.01" />
      <path d="M3.5 4.5v4.2h4.2" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v10.5" />
      <path d="m7.75 10.25 4.25 4.25 4.25-4.25" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  sparkle: (
    <>
      <path d="M11 3.5l1.7 4.3 4.3 1.7-4.3 1.7L11 15.5l-1.7-4.3L5 9.5l4.3-1.7z" />
      <path d="M17.75 14.5l.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5c-4.7 0-8.5 3.8-8.5 8.5s3.8 8.5 8.5 8.5a1.6 1.6 0 0 0 1.6-1.6c0-.42-.16-.8-.42-1.08a1.58 1.58 0 0 1 1.18-2.64h1.9a4.24 4.24 0 0 0 4.24-4.24c0-4.15-3.85-7.44-8.5-7.44z" />
      <circle cx="8" cy="12.75" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7.75" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.25" cy="10.75" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.1 14.4a1.5 1.5 0 0 0 .3 1.65l.06.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37v.16a1.8 1.8 0 0 1-3.6 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.05.06A1.8 1.8 0 1 1 4.47 16.3l.06-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H3.3a1.8 1.8 0 0 1 0-3.6h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.05A1.8 1.8 0 1 1 7 4.86l.05.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .91-1.37V3.7a1.8 1.8 0 0 1 3.6 0v.09a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.05-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.16a1.8 1.8 0 0 1 0 3.6h-.09a1.5 1.5 0 0 0-1.37.91z" />
    </>
  ),
  /** The agent's pointer. Same shape the agent cursor draws on the page. */
  agent: <path d="M5.4 3.4 11.9 19.6l2.3-6.2 6.2-2.3z" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  'chevron-down': <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  'chevron-up': <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />,
  'chevron-right': <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  pin: (
    <>
      <path d="M12 16.5V21" />
      <path d="M9.25 10.6V6.5h-.5a2 2 0 0 1 0-4h6.5a2 2 0 0 1 0 4h-.5v4.1a2 2 0 0 0 1.1 1.79l1.15.57a2 2 0 0 1 1.1 1.79v.75H6.4v-.75a2 2 0 0 1 1.1-1.79l1.15-.57a2 2 0 0 0 1.1-1.79z" />
    </>
  ),
  check: <path d="m5.5 12.5 4.5 4.5 8.5-9.5" />,
  trash: (
    <>
      <path d="M4.5 6.75h15" />
      <path d="M9.75 10.5v6M14.25 10.5v6" />
      <path d="M6.5 6.75 7.3 19a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12.25" />
      <path d="M9.5 6.75V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.75" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5h4.5" />
    </>
  ),
  folder: (
    <path d="M3.5 7a2 2 0 0 1 2-2h3.4a2 2 0 0 1 1.4.58L11.7 6.9h6.8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  key: (
    <>
      <circle cx="8" cy="16" r="4" />
      <path d="m10.9 13.1 8.6-8.6" />
      <path d="m17 6.5 2 2" />
      <path d="m14.2 9.3 2 2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15h-.5A1.5 1.5 0 0 1 3.5 13.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" />
    </>
  ),
  'stop-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1.2" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19.5v-15" />
      <path d="m5.75 10.75 6.25-6.25 6.25 6.25" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 4.5v15" />
      <path d="m5.75 13.25 6.25 6.25 6.25-6.25" />
    </>
  ),
  /** "Aa": the case-sensitivity toggle in the find bar. */
  'match-case': (
    <>
      <path d="m2.75 17 4.4-10.5L11.55 17" />
      <path d="M4.4 13.25h5.5" />
      <circle cx="17.25" cy="13.5" r="3.5" />
      <path d="M20.75 10v7" />
    </>
  ),

  /** Six dots: the standard "this row can be dragged" mark. */
  grip: (
    <>
      <circle cx="9" cy="6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),

  /* ----------------------------------------------------- omnibox status */
  /** https. */
  lock: (
    <>
      <rect x="4.75" y="10.5" width="14.5" height="9.75" rx="2" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
    </>
  ),
  /** Plain http. Stated, not alarmed about. */
  'lock-open': (
    <>
      <rect x="4.75" y="10.5" width="14.5" height="9.75" rx="2" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.2-1.4" />
    </>
  ),
  /** Anything that is not a web page: about:, file:, data:. */
  page: (
    <>
      <path d="M6 3.75h7.5L18.5 8.5v11.75H6z" />
      <path d="M13.25 3.9V8.6h4.9" />
    </>
  ),

  /* ------------------------------------------------------- quick actions */
  /** Summarize: lines shortening down the page. */
  list: (
    <>
      <path d="M4.5 7h15" />
      <path d="M4.5 12h11" />
      <path d="M4.5 17h7" />
    </>
  ),
  /** Extract facts: a tag pulled out of the page. */
  tag: (
    <>
      <path d="M11.4 3.5H20.5v9.1l-8.6 8.6a1.5 1.5 0 0 1-2.1 0l-7-7a1.5 1.5 0 0 1 0-2.1z" />
      <circle cx="16.4" cy="7.6" r="1.35" />
    </>
  ),
  /** Explain. */
  question: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.1 2.9c-.5.15-.7.5-.7 1v.7" />
      <path d="M12 16.9v.05" />
    </>
  ),
  /** Translate: two glyphs swapping. */
  translate: (
    <>
      <path d="M3.25 6h8" />
      <path d="M7.25 4v2" />
      <path d="M9.6 6c0 3.6-2.6 6.6-6.35 7.5" />
      <path d="M5.1 9.4c.9 2 2.6 3.5 4.9 4.1" />
      <path d="m12.75 20 3.9-9.5 3.9 9.5" />
      <path d="M14.2 16.6h4.9" />
    </>
  ),
  /** Simplify: a wand. */
  wand: (
    <>
      <path d="m4.5 19.5 11-11" />
      <path d="m14 7 3 3" />
      <path d="M18.5 3.5v3M20 5h-3" />
      <path d="M20.5 13v2.5M21.75 14.25h-2.5" />
    </>
  ),
  /** What is missing: a balance, tipped. */
  balance: (
    <>
      <path d="M12 4.5v15" />
      <path d="M6.5 19.5h11" />
      <path d="M4 8.5h16" />
      <path d="M4 8.5 1.75 14a2.6 2.6 0 0 0 4.5 0z" />
      <path d="M20 8.5 17.75 14a2.6 2.6 0 0 0 4.5 0z" />
    </>
  ),
  /** A warning that is worth reading, not a failure: a contrast pair below AA. */
  alert: (
    <>
      <path d="M12 4.2 21 19.5H3z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.1h.01" />
    </>
  ),
  /** Undo, in the "put back what was there" sense. */
  revert: (
    <>
      <path d="M4 9.5h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M7.75 5.75 3.5 9.5l4.25 3.75" />
    </>
  ),
  /** Across every tab: stacked planes. */
  layers: (
    <>
      <path d="m12 3.25 8.5 4.25L12 11.75 3.5 7.5z" />
      <path d="m3.5 12.25 8.5 4.25 8.5-4.25" />
      <path d="m3.5 16.75 8.5 4.25 8.5-4.25" />
    </>
  )
} as const satisfies Record<string, ReactNode>

/** Every icon this build ships. Typed so a typo fails the build. */
export type IconName = keyof typeof ICONS

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** Edge length in px. The stroke weight stays constant across sizes. */
  size?: number
}

export function Icon({ name, size = 16, className, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      {...rest}
      className={['rx-icon', className].filter(Boolean).join(' ')}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}
