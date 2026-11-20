import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MINDS_BUDGETS_URL } from '../../lib/mindsUrls';
import { useBudgetsUrl } from './useBudgetsUrl';

const mockUser = vi.fn();
vi.mock('./useAccountUser', () => ({ useAccountUser: () => mockUser() }));

describe('useBudgetsUrl', () => {
  it("names the session's organization and account, so the console opens that org's Budgets", () => {
    mockUser.mockReturnValue({ orgId: 'org-123', sub: 'user-9' });
    const url = new URL(renderHook(() => useBudgetsUrl()).result.current);

    expect(url.searchParams.get('tab')).toBe('budgets');
    expect(url.searchParams.get('organization')).toBe('org-123');
    expect(url.searchParams.get('subject')).toBe('user-9');
  });

  it('tags a link opened from a budget denial, so the console counts the visit as one', () => {
    mockUser.mockReturnValue({ orgId: 'org-123', sub: 'user-9' });
    const denial = new URL(renderHook(() => useBudgetsUrl({ fromDenial: true })).result.current);
    const plain = new URL(renderHook(() => useBudgetsUrl()).result.current);

    expect(denial.searchParams.get('from')).toBe('budget_denial');
    expect(denial.searchParams.get('organization')).toBe('org-123');
    expect(plain.searchParams.get('from')).toBeNull();
  });

  it('falls back to the bare Budgets link before the account resolves', () => {
    mockUser.mockReturnValue(null);
    expect(renderHook(() => useBudgetsUrl()).result.current).toBe(new URL(MINDS_BUDGETS_URL).toString());
  });
});
