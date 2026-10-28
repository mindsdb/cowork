// Whether the server keeps a custom connector built by this caller.

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { BASE, fetchCanBuildCustomConnector } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

function answer(status, body) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } },
  ));
}

it.each([
  [true, true],
  [false, false],
])('asks the server and returns can_build %s', async (canBuild, expected) => {
  const fetch = answer(200, { can_build: canBuild });

  await expect(fetchCanBuildCustomConnector()).resolves.toBe(expected);
  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/connectors/specs/custom-availability`);
});

it('keeps the old answer, yes, against a server without the route', async () => {
  answer(404, { detail: 'Connector not found.' });

  await expect(fetchCanBuildCustomConnector()).resolves.toBe(true);
});
