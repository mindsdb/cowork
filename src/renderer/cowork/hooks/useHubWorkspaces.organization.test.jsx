import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  fetchHubWorkspaces: vi.fn(),
  setActiveHubWorkspace: vi.fn(),
}));
const hostMock = vi.hoisted(() => ({
  mindshubListOrgs: vi.fn(),
  mindshubSwitchOrg: vi.fn(),
}));
vi.mock('../api', () => apiMock);
vi.mock('../../platform/host', () => hostMock);
vi.mock('../lib/organizationTransition', () => ({ prepareForOrganizationReload: vi.fn() }));

import { useHubWorkspaces } from './useHubWorkspaces';
import { useMindsOrgs } from './useMindsOrgs';

const USER = { sub: 'user-1' };
const ORGS = [{ id: 'org-a' }, { id: 'org-b' }];
const listing = (org, count) => ({
  enabled: true,
  reachable: true,
  workspaces: Array.from({ length: count }, (_, i) => ({ id: `${org}-${i}`, displayName: `${org} ${i}` })),
  activeWorkspaceId: `${org}-0`,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  apiMock.fetchHubWorkspaces.mockReset();
  apiMock.setActiveHubWorkspace.mockReset();
  hostMock.mindshubListOrgs.mockReset();
  hostMock.mindshubSwitchOrg.mockReset();
  hostMock.mindshubListOrgs.mockResolvedValue({ orgs: ORGS, activeOrgId: 'org-a' });
  hostMock.mindshubSwitchOrg.mockResolvedValue({ ok: true, orgs: ORGS, activeOrgId: 'org-b' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('workspace reads after an in-place organization switch', () => {
  it.each([[1, 2], [2, 1]])('replaces %i old rows with %i new rows for the same subject', async (before, after) => {
    const next = deferred();
    apiMock.fetchHubWorkspaces
      .mockResolvedValueOnce(listing('org-a', before))
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => ({
      workspaces: useHubWorkspaces(USER),
      organizations: useMindsOrgs(USER),
    }));
    await waitFor(() => expect(result.current.workspaces.workspaces).toHaveLength(before));

    await act(async () => { await result.current.organizations.switchOrg('org-b'); });

    expect(result.current.workspaces.workspaces).toEqual([]);
    expect(result.current.workspaces.activeWorkspaceId).toBeNull();
    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2);

    await act(async () => { next.resolve(listing('org-b', after)); });

    expect(result.current.workspaces.workspaces).toHaveLength(after);
    expect(result.current.workspaces.activeWorkspaceId).toBe('org-b-0');
  });

  it('drops the old organization\'s read and switch while allowing the new switch to finish', async () => {
    const oldRead = deferred();
    const oldSwitch = deferred();
    const newSwitch = deferred();
    apiMock.fetchHubWorkspaces
      .mockResolvedValueOnce(listing('org-a', 2))
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(listing('org-b', 2));
    apiMock.setActiveHubWorkspace
      .mockReturnValueOnce(oldSwitch.promise)
      .mockReturnValueOnce(newSwitch.promise);
    const { result } = renderHook(() => ({
      workspaces: useHubWorkspaces(USER),
      organizations: useMindsOrgs(USER),
    }));
    await waitFor(() => expect(result.current.workspaces.activeWorkspaceId).toBe('org-a-0'));

    let pendingRead;
    let pendingOldSwitch;
    act(() => {
      pendingRead = result.current.workspaces.refresh();
      pendingOldSwitch = result.current.workspaces.switchWorkspace('org-a-1');
    });
    expect(result.current.workspaces.switching).toBe(true);

    await act(async () => { await result.current.organizations.switchOrg('org-b'); });
    expect(result.current.workspaces.activeWorkspaceId).toBe('org-b-0');
    expect(result.current.workspaces.switching).toBe(false);

    let pendingNewSwitch;
    act(() => { pendingNewSwitch = result.current.workspaces.switchWorkspace('org-b-1'); });
    await act(async () => {
      oldRead.resolve(listing('org-a', 1));
      oldSwitch.resolve({ ...listing('org-a', 2), activeWorkspaceId: 'org-a-1' });
      await Promise.all([pendingRead, pendingOldSwitch]);
    });
    expect(result.current.workspaces.activeWorkspaceId).toBe('org-b-0');
    expect(result.current.workspaces.workspaces).toHaveLength(2);
    expect(result.current.workspaces.switching).toBe(true);

    await act(async () => {
      newSwitch.resolve({ ...listing('org-b', 2), activeWorkspaceId: 'org-b-1' });
      await pendingNewSwitch;
    });
    expect(result.current.workspaces.activeWorkspaceId).toBe('org-b-1');
    expect(result.current.workspaces.switching).toBe(false);
  });
});
