import { describe, expect, it } from 'vitest';
import { budgetScopeOf } from './budgetScope';

describe('budgetScopeOf', () => {
  it.each(['org', 'workspace', 'api_key'])('keeps the named scope %s', (scope) => {
    expect(budgetScopeOf(scope)).toBe(scope);
  });

  it.each([undefined, null, '', 'team', 'all_members', 42])('reads %s as unnamed', (value) => {
    expect(budgetScopeOf(value)).toBe('other');
  });
});
