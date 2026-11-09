/* The shared browser's status call carries no MindsHub credential header: the
   desktop's local server answers it from what it holds, and on the web the
   shell's Authorization header already names the caller. */
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
import { SHORT_REQUEST_TIMEOUT_MS, approveBrowserStep, declineBrowserStep, embedBrowser, fetchBrowseStatus, signOutOfBrowserSites } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

function answering(body, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } },
  ));
}

function hubCredential(init) {
  return Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]))['x-mindshub-authorization'];
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

it('records an approval for exactly the session and held step it is given, with the person credential', async () => {
  const fetch = answering({ pending_id: 'pa-1', approved: true, expires_at: 1 });
  expect(await approveBrowserStep('t-abc', 'pa-1')).toEqual({ pending_id: 'pa-1', approved: true, expires_at: 1 });
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toMatch(/\/browse\/approve$/);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ session_id: 't-abc', pending_id: 'pa-1' });
  expect(hubCredential(init)).toBe('Bearer kc-token');
});

it('declines exactly the session and held step it is given, with the person credential', async () => {
  const fetch = answering({});
  await declineBrowserStep('t-abc', 'pa-1');
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toMatch(/\/browse\/decline$/);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ session_id: 't-abc', pending_id: 'pa-1' });
  expect(hubCredential(init)).toBe('Bearer kc-token');
});

it('rejects with the status when the server has no decline route', async () => {
  answering({ detail: 'Not Found' }, 404);
  await expect(declineBrowserStep('t-abc', 'pa-1')).rejects.toMatchObject({ status: 404 });
});

it('gives up on a decline the server never answers, so the card can answer', async () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const declined = expect(declineBrowserStep('t-abc', 'pa-1')).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(SHORT_REQUEST_TIMEOUT_MS);
    await declined;
  } finally {
    vi.useRealTimers();
  }
});

it('gives up on a status read the server never answers, at the limit it is given', async () => {
  vi.useFakeTimers();
  try {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    let failed = null;
    const read = fetchBrowseStatus({ timeoutMs: 20_000 }).catch((error) => {
      failed = error;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await read;
    expect(failed).toMatchObject({ name: 'AbortError' });
  } finally {
    vi.useRealTimers();
  }
});

it('signs out of every site with a DELETE and the person credential', async () => {
  const fetch = answering({ cleared: true });
  expect(await signOutOfBrowserSites()).toEqual({ cleared: true });
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toMatch(/\/browse\/logins$/);
  expect(init.method).toBe('DELETE');
  expect(init.body).toBeUndefined();
  expect(hubCredential(init)).toBe('Bearer kc-token');
});
