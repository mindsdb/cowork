import { expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
const token = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: token, isWeb: true },
}));
import { fetchHubUsage, fetchHubWorkspaces, setActiveHubWorkspace } from './api';

it('blocks every hub API before credentials or network requests are read', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).includes('/workspaces')
      ? { enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null }
      : { reachable: false },
  ), { status: 200 }));
  expect(await fetchHubUsage()).toEqual({ reachable: false });
  expect(await fetchHubWorkspaces()).toEqual({
    enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null,
  });
  await expect(setActiveHubWorkspace('workspace')).rejects.toThrow('unavailable');
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
