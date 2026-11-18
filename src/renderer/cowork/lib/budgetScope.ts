/** Whose budget stopped a turn, as the ICU `scope` select reads it. */
export type BudgetScope = 'org' | 'workspace' | 'api_key' | 'team' | 'member' | 'other';

/** The spent budget's period, as the ICU `period` select reads it. */
export type BudgetPeriod = 'day' | 'month' | 'year' | 'other';

// user and all_members both cap the person's own spend, so they read the same.
const SCOPES: Readonly<Record<string, BudgetScope>> = {
  org: 'org', workspace: 'workspace', api_key: 'api_key', team: 'team', user: 'member', all_members: 'member',
};
const PERIODS: ReadonlySet<string> = new Set(['day', 'month', 'year']);

/** The gateway's `budget_scope`; a missing or newer value reads as unnamed (`other`). */
export function budgetScopeOf(value: unknown): BudgetScope {
  return typeof value === 'string' && Object.hasOwn(SCOPES, value) ? SCOPES[value] : 'other';
}

/** The gateway's `budget_period`; a missing or unknown value reads as `other`. */
export function budgetPeriodOf(value: unknown): BudgetPeriod {
  return typeof value === 'string' && PERIODS.has(value) ? (value as BudgetPeriod) : 'other';
}

/** A per-model budget's model as the user sees it: its catalog label, else the raw alias (never prettified). */
export function budgetModelName(
  id: string,
  labels?: Readonly<Record<string, string>> | null,
  fallback?: (id: string) => string | undefined | null,
): string {
  const label = labels && Object.hasOwn(labels, id) ? labels[id] : undefined;
  return label || fallback?.(id) || id;
}
