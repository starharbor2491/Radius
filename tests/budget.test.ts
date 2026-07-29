import { describe, expect, it } from 'vitest'
import type { UsageRecord } from '@shared/types'
import {
  BudgetConfigSchema,
  budgetFraction,
  defaultBudgetConfig,
  evaluateBudget,
  formatUsd,
  groupSpend,
  isBlocked,
  parseBudgetConfig,
  spendInWindow,
  startOfMonthMs,
  untrackedRuns,
  type BudgetConfig
} from '@shared/budget'

let sequence = 0
const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id: `u${(sequence += 1)}`,
  providerId: 'openai',
  modelId: 'gpt-4o',
  feature: 'chat',
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.01,
  createdAt: 1000,
  ...overrides
})

const budget = (overrides: Partial<BudgetConfig> = {}): BudgetConfig =>
  BudgetConfigSchema.parse({ enabled: true, monthlyLimitUsd: 10, ...overrides })

describe('budget config schema', () => {
  it('is off by default, so a fresh install never refuses to answer', () => {
    const parsed = defaultBudgetConfig()
    expect(parsed.enabled).toBe(false)
    expect(parsed.atLimit).toBe('warn')
    expect(parsed.warnAtPercent).toBe(80)
  })

  it('rejects a negative limit and an out-of-range warn threshold', () => {
    expect(() => BudgetConfigSchema.parse({ monthlyLimitUsd: -1 })).toThrow()
    expect(() => BudgetConfigSchema.parse({ warnAtPercent: 0 })).toThrow()
    expect(() => BudgetConfigSchema.parse({ warnAtPercent: 101 })).toThrow()
  })

  it('falls back to defaults for a corrupt stored document', () => {
    expect(parseBudgetConfig({ atLimit: 'explode' })).toEqual(defaultBudgetConfig())
    expect(parseBudgetConfig(null)).toEqual(defaultBudgetConfig())
  })
})

describe('startOfMonthMs', () => {
  it('is midnight on the first of the containing month', () => {
    const middle = new Date(2026, 2, 17, 13, 45, 12).getTime()
    const start = new Date(startOfMonthMs(middle))
    expect(start.getDate()).toBe(1)
    expect(start.getMonth()).toBe(2)
    expect(start.getHours()).toBe(0)
    expect(startOfMonthMs(middle)).toBeLessThanOrEqual(middle)
  })
})

describe('spendInWindow', () => {
  it('sums nothing over an empty log', () => {
    expect(spendInWindow([], 0)).toBe(0)
  })

  it('adds only records at or after the boundary', () => {
    const records = [
      record({ createdAt: 99, costUsd: 5 }),
      record({ createdAt: 100, costUsd: 1 }),
      record({ createdAt: 101, costUsd: 2 })
    ]
    // The boundary itself counts: a run at the first millisecond of the month
    // belongs to that month.
    expect(spendInWindow(records, 100)).toBe(3)
  })

  it('counts an unpriced run as nothing rather than guessing', () => {
    const records = [record({ costUsd: 0 }), record({ costUsd: 0.5 })]
    expect(spendInWindow(records, 0)).toBe(0.5)
    expect(untrackedRuns(records, 0)).toBe(1)
  })

  it('does not accumulate float noise across many small runs', () => {
    const records = Array.from({ length: 10 }, () => record({ costUsd: 0.1 }))
    expect(spendInWindow(records, 0)).toBe(1)
  })

  it('ignores a non-finite cost rather than poisoning the total', () => {
    expect(spendInWindow([record({ costUsd: Number.NaN }), record({ costUsd: 2 })], 0)).toBe(2)
  })
})

describe('evaluateBudget', () => {
  it('is ok while the budget is disabled, whatever the spend', () => {
    expect(evaluateBudget(BudgetConfigSchema.parse({ monthlyLimitUsd: 1 }), 100)).toBe('ok')
  })

  it('is ok when no limit is set', () => {
    expect(evaluateBudget(budget({ monthlyLimitUsd: 0 }), 100)).toBe('ok')
  })

  it('is ok below the warn threshold', () => {
    expect(evaluateBudget(budget({ warnAtPercent: 80 }), 0)).toBe('ok')
    expect(evaluateBudget(budget({ warnAtPercent: 80 }), 7.99)).toBe('ok')
  })

  it('warns exactly at the threshold', () => {
    expect(evaluateBudget(budget({ warnAtPercent: 80 }), 8)).toBe('warn')
    expect(evaluateBudget(budget({ warnAtPercent: 80 }), 9.99)).toBe('warn')
  })

  it('is over exactly at the limit -- a limit you may sit on is not a limit', () => {
    expect(evaluateBudget(budget(), 10)).toBe('over')
    expect(evaluateBudget(budget(), 10.01)).toBe('over')
  })

  it('handles a 100% warn threshold without warning before the limit', () => {
    expect(evaluateBudget(budget({ warnAtPercent: 100 }), 9.99)).toBe('ok')
    expect(evaluateBudget(budget({ warnAtPercent: 100 }), 10)).toBe('over')
  })
})

describe('isBlocked', () => {
  it('blocks only when over and set to block', () => {
    expect(isBlocked(budget({ atLimit: 'block' }), 10)).toBe(true)
    expect(isBlocked(budget({ atLimit: 'block' }), 9)).toBe(false)
    expect(isBlocked(budget({ atLimit: 'warn' }), 100)).toBe(false)
    expect(isBlocked(BudgetConfigSchema.parse({ atLimit: 'block' }), 1e6)).toBe(false)
  })
})

describe('budgetFraction', () => {
  it('clamps to the bar the UI can actually draw', () => {
    expect(budgetFraction(budget(), 5)).toBe(0.5)
    expect(budgetFraction(budget(), 25)).toBe(1)
    expect(budgetFraction(budget(), 0)).toBe(0)
    expect(budgetFraction(budget({ monthlyLimitUsd: 0 }), 5)).toBe(0)
  })
})

describe('groupSpend', () => {
  it('rolls up per provider and model, most expensive first', () => {
    const groups = groupSpend([
      record({ providerId: 'openai', modelId: 'gpt-4o', costUsd: 0.2 }),
      record({ providerId: 'openai', modelId: 'gpt-4o', costUsd: 0.3, inputTokens: 10 }),
      record({ providerId: 'ollama', modelId: 'llama3', costUsd: 0 })
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.modelId).toBe('gpt-4o')
    expect(groups[0]!.runs).toBe(2)
    expect(groups[0]!.costUsd).toBeCloseTo(0.5, 6)
    expect(groups[0]!.inputTokens).toBe(1010)
    expect(groups[1]!.untracked).toBe(1)
  })

  it('respects the window boundary', () => {
    expect(groupSpend([record({ createdAt: 5 })], 10)).toEqual([])
  })
})

describe('formatUsd', () => {
  it('never rounds a real cost away to $0.00', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.0031)).toBe('$0.0031')
    expect(formatUsd(1.239)).toBe('$1.24')
  })
})
