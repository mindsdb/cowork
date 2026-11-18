import { describe, expect, it } from 'vitest';
import { budgetPeriodOf, budgetScopeOf } from './budgetScope';

describe('budgetScopeOf', () => {
  it.each(['org', 'workspace', 'api_key', 'team'])('keeps the named scope %s', (scope) => {
    expect(budgetScopeOf(scope)).toBe(scope);
  });

  it.each(['user', 'all_members'])('reads %s as the member scope', (scope) => {
    expect(budgetScopeOf(scope)).toBe('member');
  });

  it.each([undefined, null, '', 'member', 'guild', 'constructor', 42])('reads %s as unnamed', (value) => {
    expect(budgetScopeOf(value)).toBe('other');
  });
});

describe('budgetPeriodOf', () => {
  it.each(['day', 'month', 'year'])('keeps the period %s', (period) => {
    expect(budgetPeriodOf(period)).toBe(period);
  });

  it.each([undefined, null, '', 'week', 'Day', 7])('reads %s as no period', (value) => {
    expect(budgetPeriodOf(value)).toBe('other');
  });
});
