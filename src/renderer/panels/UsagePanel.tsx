import { useEffect, useMemo, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import type { ProviderStatus, UsageRecord } from '@shared/types'
import {
  budgetFraction,
  evaluateBudget,
  formatUsd,
  groupSpend,
  parseBudgetConfig,
  spendInWindow,
  startOfMonthMs,
  untrackedRuns
} from '@shared/budget'
import { featureLabel } from '@shared/routing'
import { useAppStore } from '../store/useAppStore'
import { bridge } from '../lib/bridge'
import { useMotionTokens } from '../lib/motion'
import { Button } from '../ui/primitives'
import { BudgetControls } from './BudgetControls'

/**
 * What the AI has cost this month, and the budget it is measured against.
 *
 * The number shown is *tracked* spend: a model whose provider publishes no
 * pricing is recorded at zero rather than guessed at, so this panel states how
 * many runs were unpriced instead of letting the total imply completeness.
 */
export function UsagePanel(): JSX.Element {
  const settings = useAppStore((store) => store.state.settings)
  const providers = useAppStore((store) => store.state.providers)
  const { spring, tween, stagger } = useMotionTokens()

  const [records, setRecords] = useState<UsageRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const budget = useMemo(() => parseBudgetConfig(settings.aiBudget), [settings.aiBudget])
  const since = useMemo(() => startOfMonthMs(), [])

  /*
   * Usage is not part of the state snapshot -- it grows without bound and the
   * chrome only needs it while this panel is open. Re-read whenever a snapshot
   * lands, which is what a finished run produces.
   */
  useEffect(() => {
    const load = (): void => {
      void bridge
        .invoke('ai:usage', { sinceMs: since })
        .then((rows) => {
          setRecords(rows)
          setLoaded(true)
        })
        .catch(() => setLoaded(true))
    }
    load()
    return bridge.on('state:changed', load)
  }, [since])

  const spend = spendInWindow(records, since)
  const untracked = untrackedRuns(records, since)
  const status = evaluateBudget(budget, spend)
  const fraction = budgetFraction(budget, spend)
  const groups = useMemo(() => groupSpend(records, since), [records, since])

  const byFeature = useMemo(() => {
    const totals = new Map<string, { runs: number; costUsd: number }>()
    for (const record of records) {
      const current = totals.get(record.feature) ?? { runs: 0, costUsd: 0 }
      totals.set(record.feature, {
        runs: current.runs + 1,
        costUsd: current.costUsd + record.costUsd
      })
    }
    return [...totals.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd || b[1].runs - a[1].runs)
  }, [records])

  return (
    <div className="rx-panel-scroll">
      <section>
        <div className="rx-section-title">This month</div>
        <div className="rx-card">
          <div className="rx-row-between">
            <strong style={{ fontSize: 'var(--rx-text-2)' }}>{formatUsd(spend)}</strong>
            <span className="rx-faint">
              {budget.enabled && budget.monthlyLimitUsd > 0
                ? `of ${formatUsd(budget.monthlyLimitUsd)} budget`
                : 'no budget set'}
            </span>
          </div>

          {budget.enabled && budget.monthlyLimitUsd > 0 ? (
            <div className="rx-meter" data-status={status}>
              <motion.div
                className="rx-meter-fill"
                initial={false}
                animate={{ width: `${Math.round(fraction * 100)}%` }}
                transition={spring('panel')}
              />
            </div>
          ) : null}

          {status === 'warn' ? (
            <span className="rx-notice">
              Past {budget.warnAtPercent}% of the monthly budget.
            </span>
          ) : null}
          {status === 'over' ? (
            <span className="rx-notice">
              Over the monthly budget.{' '}
              {budget.atLimit === 'block'
                ? 'New requests are being blocked.'
                : 'Requests still run; the budget only warns.'}
            </span>
          ) : null}

          {/*
            The honest caveat, not a footnote to be dropped: cost is only known
            for models with published pricing.
          */}
          <span className="rx-faint">
            {records.length === 0
              ? loaded
                ? 'No AI usage recorded this month.'
                : 'Reading usage…'
              : untracked > 0
                ? `${records.length} run(s). ${untracked} used a model with no published pricing and ` +
                  `count as $0 — real spend is higher than the figure above.`
                : `${records.length} run(s), all on models with published pricing.`}
          </span>
        </div>
      </section>

      <section>
        <div className="rx-section-title">Budget</div>
        <div className="rx-card">
          <BudgetControls />
        </div>
      </section>

      <section>
        <div className="rx-section-title">By model</div>
        {groups.length === 0 ? (
          <div className="rx-faint">Nothing to break down yet.</div>
        ) : (
          <div className="rx-card" style={{ padding: 0, gap: 0 }}>
            {groups.map((group, index) => (
              <motion.div
                key={`${group.providerId} ${group.modelId}`}
                className="rx-usage-row"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...tween('fast'), delay: stagger(Math.min(index, 10)) }}
              >
                <span className="rx-tab-title" title={group.modelId}>
                  {providerLabel(providers, group.providerId)} · {group.modelId}
                </span>
                <strong>{formatUsd(group.costUsd)}</strong>
                <span className="rx-faint">
                  {group.runs} run(s) · {group.inputTokens.toLocaleString()} in ·{' '}
                  {group.outputTokens.toLocaleString()} out
                </span>
                <span className="rx-faint">
                  {group.untracked > 0 ? `${group.untracked} unpriced` : ''}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="rx-section-title">By feature</div>
        {byFeature.length === 0 ? (
          <div className="rx-faint">Nothing to break down yet.</div>
        ) : (
          <div className="rx-card" style={{ padding: 0, gap: 0 }}>
            {byFeature.map(([feature, totals]) => (
              <div key={feature} className="rx-usage-row">
                <span className="rx-tab-title">{featureLabel(feature)}</span>
                <strong>{formatUsd(totals.costUsd)}</strong>
                <span className="rx-faint">{totals.runs} run(s)</span>
                <span />
              </div>
            ))}
          </div>
        )}
      </section>

      <Button
        variant="outline"
        onClick={() => {
          void bridge.invoke('ai:usage', { sinceMs: since }).then(setRecords)
        }}
      >
        Refresh
      </Button>
    </div>
  )
}

function providerLabel(providers: ProviderStatus[], providerId: string): string {
  return providers.find((provider) => provider.id === providerId)?.label ?? providerId
}
