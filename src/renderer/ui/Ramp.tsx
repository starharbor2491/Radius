import type { JSX } from 'react'

/**
 * A slider on one row: label, track, value.
 *
 * The shared `Slider` stacks its label above its track, which is right for a
 * settings form and wrong for a column of a dozen tokens -- the studios are the
 * one place where the labels outnumber the content.
 */
export function Ramp({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}): JSX.Element {
  const ratio = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  return (
    <label className="rx-ramp">
      <span className="rx-ramp-label">{label}</span>
      <input
        className="rx-slider"
        data-radius-part="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--rx-slider-fill' as string]: `${ratio}%` }}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
      <span className="rx-ramp-value">
        {Math.round(value * 100) / 100}
        {suffix}
      </span>
    </label>
  )
}
