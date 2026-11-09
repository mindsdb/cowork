import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
const api = vi.hoisted(() => ({
  fetchHubUsage: vi.fn(), fetchHubWorkspaces: vi.fn(), setActiveHubWorkspace: vi.fn(),
}));
vi.mock('../api', () => api);
const host = vi.hoisted(() => ({
  isElectron: false, mindshubListOrgs: vi.fn(), mindshubSwitchOrg: vi.fn(),
}));
vi.mock('../../platform/host', () => host);
const subscribe = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('../lib/organizationChanges', () => ({
  subscribeOrganizationChanges: subscribe, notifyOrganizationChanged: vi.fn(),
}));

import { useHubUsage } from './useHubUsage';
import { useHubWorkspaces } from './useHubWorkspaces';
import { useMindsOrgs } from './useMindsOrgs';

afterEach(() => vi.useRealTimers());

it('makes no platform reads, retries, subscriptions or switches for a signed-in account', async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ sub }) => ({
    usage: useHubUsage({ sub }),
    workspaces: useHubWorkspaces({ sub }),
    orgs: useMindsOrgs({ sub }),
  }), { initialProps: { sub: 'alice' } });
  await act(async () => {
    await result.current.usage.refresh();
    await result.current.workspaces.refresh();
    await result.current.workspaces.switchWorkspace('workspace');
    await result.current.orgs.refresh();
    await result.current.orgs.switchOrg('org');
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
  });
  rerender({ sub: 'bob' });
  expect(result.current.usage.usage).toEqual({ reachable: false });
  expect(result.current.workspaces.enabled).toBe(false);
  expect(result.current.orgs.orgs).toEqual([]);
  for (const fn of [...Object.values(api), host.mindshubListOrgs, host.mindshubSwitchOrg, subscribe]) {
    expect(fn).not.toHaveBeenCalled();
  }
  expect(vi.getTimerCount()).toBe(0);
});
