import { useMemo, type JSX } from 'react'
import { parseBudgetConfig, type BudgetConfig } from '@shared/budget'
import { useAppStore } from '../store/useAppStore'
import { send } from '../lib/bridge'
import { Field } from '../ui/primitives'

/**
 * The monthly spend budget, editable.
 *
 * Shared by Settings and the usage panel rather than written twice, so the two
 * can never disagree about what a field means. The config round-trips through
 * main like every other mutation -- this component holds no local copy.
 */
export function BudgetControls(): JSX.Element {
  const settings = useAppStore((store) => store.state.settings)
  const budget = useMemo(() => parseBudgetConfig(settings.aiBudget), [settings.aiBudget])

  const patch = (next: Partial<BudgetConfig>): void => {
    send('ai:setBudget', { config: { ...budget, ...next } })
  }

  return (
    <>
      <label className="rx-row">
        <input
          type="checkbox"
          checked={budget.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        <span>Track spend against a monthly limit</span>
      </label>

      <Field label="Monthly limit (USD)">
        <input
          className="rx-input"
          type="number"
          min={0}
          step={1}
          value={budget.monthlyLimitUsd}
          onChange={(event) =>
            patch({ monthlyLimitUsd: Math.max(0, Number.parseFloat(event.target.value) || 0) })
          }
        />
      </Field>

      <Field label="Warn at (% of limit)">
        <input
          className="rx-input"
          type="number"
          min={1}
          max={100}
          step={1}
          value={budget.warnAtPercent}
          onChange={(event) =>
            patch({
              warnAtPercent: Math.min(100, Math.max(1, Number.parseInt(event.target.value, 10) || 1))
            })
          }
        />
      </Field>

      <Field label="At the limit">
        <select
          className="rx-input"
          value={budget.atLimit}
          onChange={(event) => patch({ atLimit: event.target.value === 'block' ? 'block' : 'warn' })}
        >
          <option value="warn">Warn and keep going</option>
          <option value="block">Block new requests</option>
        </select>
      </Field>

      {/*
        Said plainly rather than buried: the budget bounds what Radius can
        price. A model with no published pricing is recorded at $0 (see
        `estimateCost`), so real spend can exceed a limit that never trips.
      */}
      <span className="rx-faint">
        The limit applies to tracked spend only. Models with no published pricing are recorded at
        $0 and never move the bar, so actual spend can be higher.
      </span>
    </>
  )
}
