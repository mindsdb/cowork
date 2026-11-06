/* The shared browser's status call carries no MindsHub credential header: the
   desktop's local server answers it from what it holds, and on the web the
   shell's Authorization header already names the caller. */
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
import { embedBrowser, fetchBrowseStatus } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

function answering(body) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify(body),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

it('asks for the browser status with no MindsHub credential header', async () => {
  const fetch = answering({ enabled: true, available: true, status: 'running' });
  expect(await fetchBrowseStatus()).toEqual({ enabled: true, available: true, status: 'running' });
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toMatch(/\/browse\/status$/);
  expect(Object.keys(init.headers).map((name) => name.toLowerCase())).not.toContain('x-mindshub-authorization');
});

it('mints a viewer link for the session it is given', async () => {
  const fetch = answering({ session_id: 't-abc', view_url: 'x', expires_at: 1 });
  await embedBrowser('t-abc');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ session_id: 't-abc' });
});
