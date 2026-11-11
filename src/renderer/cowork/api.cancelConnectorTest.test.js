// Ending a waiting connection test: the reason rides in the query string and
// the body stays exactly one id, which a server without the reason accepts.

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { BASE, cancelConnectorTest } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

function noContent() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 204 }));
}

it.each([
  [{ confirmId: 'cf_1', reason: 'declined' }, '?reason=declined', { confirm_id: 'cf_1' }],
  [{ approvalId: 'ap_1', reason: 'ended' }, '?reason=ended', { approval_id: 'ap_1' }],
  [{ confirmId: 'cf_1' }, '', { confirm_id: 'cf_1' }],
])('sends %o as the query %s and the body %o', async (args, query, body) => {
  const fetch = noContent();

  await cancelConnectorTest(args);

  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`${BASE}/connectors/submissions/cancel${query}`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual(body);
});
