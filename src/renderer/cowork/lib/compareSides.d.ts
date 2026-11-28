/*
 * Hand-written types for compareSides.js, same pattern as sharingContract.d.ts.
 * Only the usage shapes and the helpers that read them are declared: extend
 * this as TypeScript callers need more of the module. The usage shapes are
 * the answers of `GET /comparisons/{id}/usage` and the history list, with
 * camelCase fields.
 */

import type { ComparisonCostProps } from './analytics';

export type SideLabel = 'a' | 'b';

/** One turn of a side, from `GET /comparisons/{id}/usage`. */
export interface TurnUsage {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /** List-price estimate over the turn's priced calls; null when none were priced. */
  estimatedCostUsd: number | null;
  unpricedCalls: number;
  /** Calls a plan window or the Free allowance covered whole. They add no
   *  tokens and no cost, and are not unpriced. A server that predates the
   *  field leaves it out. */
  includedCalls?: number;
}

/** One side of `GET /comparisons/{id}/usage`. */
export interface SideUsage {
  /** False when the usage service had nothing for the side: no MindsHub
   *  calls (a BYOK model), a server without the usage route, or a failed
   *  read. */
  available: boolean;
  turns: TurnUsage[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
  unpricedCalls: number;
  /** Calls a plan window or the Free allowance covered whole, over every
   *  turn. A server that predates the field leaves it out. */
  includedCalls?: number;
  /** The usage service stopped at its row cap, so the totals are a floor. */
  truncated: boolean;
}

/** `GET /comparisons/{id}/usage`: each side's usage by its label. */
export interface ComparisonUsage {
  sides: Partial<Record<SideLabel, SideUsage>>;
}

/** A side's cost as last read, which the history list carries on each side. */
export interface SideUsageSnapshot {
  estimatedCostUsd: number | null;
  tokens: number;
  /** The figure leaves something out (unpriced calls, the usage service's cap). */
  partial: boolean;
  /** Calls a plan window or the Free allowance covered whole. They are in
   *  neither the cost nor the tokens, and do not make the figure partial. A
   *  snapshot taken before the field leaves it out. */
  includedCalls?: number;
}

/** Any of the three shapes that carries a figure and its included calls. */
export type UsageFigures = TurnUsage | SideUsage | SideUsageSnapshot;

/** A side's cost as shown, and the caveats that make it a floor. */
export interface SideCost {
  text: string;
  notes: string[];
  partial: boolean;
}

/** A row of a side's usage table for a turn the plan covered whole: no
 *  token count and no price. */
export interface IncludedUsageRow {
  label: string;
  time: string | null;
  included: true;
  total?: undefined;
}

/** A row of a side's usage table with its token counts and cost: a turn, or
 *  the side's total. */
export interface TokenUsageRow {
  label: string;
  time: string | null;
  input: string;
  /** The input split into full-rate, cached and cache-write tokens, for the tooltip. */
  inputDetail: string;
  output: string;
  tokens: string;
  cost: string;
  included?: undefined;
  /** Set on the side's total, the last row. */
  total?: true;
}

export type UsageRow = IncludedUsageRow | TokenUsageRow;

/** The history's Cost cell: the plan covered everything, or a figure. */
export type HistoryCost = { included: true; text?: undefined } | { text: string; included?: undefined };

/** Both sides together, and whether that leaves something out. */
export interface CombinedCost {
  text: string;
  partial: boolean;
}

export function allCallsIncluded(usage: UsageFigures | null | undefined): boolean;
export function sideCost(usage: SideUsage | null | undefined): SideCost | null;
export function turnUsageRows(
  usage: SideUsage | null | undefined,
  turns?: ReadonlyArray<{ userAt: string | null; replyAt: string | null }>,
): UsageRow[];
export function historyCost(
  sides?: ReadonlyArray<{ usage?: SideUsageSnapshot | null } | null | undefined>,
): HistoryCost | null;
export function comparisonCostProps(
  usage: ComparisonUsage | null | undefined,
  turnCounts?: Partial<Record<SideLabel, number>>,
): ComparisonCostProps;
export function combinedCost(usage: ComparisonUsage | null | undefined): CombinedCost | null;
