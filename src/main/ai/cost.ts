import type { ModelInfo, TokenUsage } from '@shared/types'

/**
 * Cost of one completion in USD.
 *
 * Returns zero when either side of the model's pricing is unknown. The cost
 * meter is a number users will make decisions on, so a missing price has to
 * read as "not counted" rather than as an invented figure.
 */
export function estimateCost(model: ModelInfo | undefined, usage: TokenUsage): number {
  if (!model?.inputPricePerMTok || !model.outputPricePerMTok) return 0
  const input = (usage.inputTokens / 1_000_000) * model.inputPricePerMTok
  const output = (usage.outputTokens / 1_000_000) * model.outputPricePerMTok
  return Math.round((input + output) * 1e6) / 1e6
}
