import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MINDS_ADD_FUNDS_URL } from '../../lib/mindsUrls';
import { useConsoleLink } from './useConsoleLink';

const mockUser = vi.fn();
vi.mock('./useAccountUser', () => ({ useAccountUser: () => mockUser() }));

describe('useConsoleLink', () => {
  it("names the session's organization and account, so the console opens that org (ENG-4333)", () => {
    mockUser.mockReturnValue({ orgId: 'org-personal', sub: 'user-9' });
    const url = new URL(renderHook(() => useConsoleLink()).result.current(MINDS_ADD_FUNDS_URL));

    expect(url.searchParams.get('exhausted')).toBe('1');
    expect(url.searchParams.get('organization')).toBe('org-personal');
    expect(url.searchParams.get('subject')).toBe('user-9');
  });

  it('leaves the link bare before the account resolves', () => {
    mockUser.mockReturnValue(null);
    const link = renderHook(() => useConsoleLink()).result.current;
    expect(link(MINDS_ADD_FUNDS_URL)).toBe(new URL(MINDS_ADD_FUNDS_URL).toString());
  });
});
