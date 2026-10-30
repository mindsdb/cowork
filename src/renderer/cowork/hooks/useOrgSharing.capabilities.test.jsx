// What org sharing allows (ENG-3787), and whether that is known yet: a
// surface that must not act before it knows reads `status`, never the
// capabilities' "off" alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ capabilities: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSkillSharingCapabilities: api.capabilities,
}));

import { __resetOrgSharingForTests, useSharingCapabilities } from './useOrgSharing';
import { SHARING_OFF } from '../lib/orgSharing';

const ACME = { enabled: true, can_share_org: true, can_write_org: true, org_name: 'Acme' };

beforeEach(() => {
  __resetOrgSharingForTests();
  api.capabilities.mockReset();
});

describe('useSharingCapabilities', () => {
  it('reads as off and loading until the answer lands, then ready', async () => {
    let answer;
    api.capabilities.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useSharingCapabilities(true));

    expect(result.current.status).toBe('loading');
    expect(result.current.capabilities).toEqual(SHARING_OFF);
    await act(async () => { answer(ACME); });
    expect(result.current.status).toBe('ready');
    expect(result.current.capabilities).toEqual(ACME);
  });

  it('says a failed read failed, rather than that sharing is off, and Retry asks again', async () => {
    api.capabilities.mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { status: 502 }));
    api.capabilities.mockResolvedValue(ACME);
    const { result } = renderHook(() => useSharingCapabilities(true));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.capabilities).toEqual(SHARING_OFF);
    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.capabilities).toEqual(ACME);
    expect(api.capabilities).toHaveBeenCalledTimes(2);
  });

  it('asks nothing while inactive', () => {
    const { result } = renderHook(() => useSharingCapabilities(false));
    expect(result.current.status).toBe('idle');
    expect(result.current.capabilities).toEqual(SHARING_OFF);
    expect(api.capabilities).not.toHaveBeenCalled();
  });
});
