// What sharing inside the org allows, and whether that is known yet: a
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

const ACME = {
  enabled: true,
  canShareSkillsOrg: true,
  canWriteSkillsOrg: true,
  canShareArtifactsOrg: true,
  permissionsKnown: true,
  teamsKnown: true,
};

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

  it('keeps an answer once it is whole, for every later surface', async () => {
    api.capabilities.mockResolvedValue(ACME);
    const first = renderHook(() => useSharingCapabilities(true));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));

    const second = renderHook(() => useSharingCapabilities(true));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(api.capabilities).toHaveBeenCalledTimes(1);
  });

  /* An answer whose permissions or teams MindsHub couldn't give is not the
     caller's answer: Retry, and the next surface that opens, ask again. */
  it.each([
    ['permissions', { permissionsKnown: false, canShareSkillsOrg: false, canShareArtifactsOrg: false }],
    ['teams', { teamsKnown: false }],
  ])('asks again for an answer without the %s', async (_, unknown) => {
    api.capabilities.mockResolvedValueOnce({ ...ACME, ...unknown });
    api.capabilities.mockResolvedValue(ACME);
    const { result } = renderHook(() => useSharingCapabilities(true));
    await waitFor(() => expect(result.current.capabilities).toEqual({ ...ACME, ...unknown }));

    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.capabilities).toEqual(ACME));
    expect(api.capabilities).toHaveBeenCalledTimes(2);
  });

  it('asks nothing while inactive', () => {
    const { result } = renderHook(() => useSharingCapabilities(false));
    expect(result.current.status).toBe('idle');
    expect(result.current.capabilities).toEqual(SHARING_OFF);
    expect(api.capabilities).not.toHaveBeenCalled();
  });
});
