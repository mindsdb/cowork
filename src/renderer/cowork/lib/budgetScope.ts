/** Whose budget stopped a turn, as the ICU `scope` select reads it. */
export type BudgetScope = 'org' | 'workspace' | 'api_key' | 'other';

const NAMED: ReadonlySet<string> = new Set(['org', 'workspace', 'api_key']);

/** The gateway's `budget_scope`; a missing or newer value reads as unnamed (`other`). */
export function budgetScopeOf(value: unknown): BudgetScope {
  return typeof value === 'string' && NAMED.has(value) ? (value as BudgetScope) : 'other';
}
