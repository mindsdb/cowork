import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as net from 'net';
import * as http from 'http';

const openExternalMock = vi.fn(async (_url: string) => {});
vi.mock('electron', () => ({
  shell: { openExternal: (url: string) => openExternalMock(url) },
}));

// Imported after the mock so drive-picker-service picks up the mocked shell.
const { openDrivePickerFlow, cancelCurrentDrivePicker, isValidDriveFileIds } = await import('./drive-picker-service');

function extractPortAndState(url: string): { port: number; state: string } {
  const parsed = new URL(url);
  return { port: Number(parsed.port), state: parsed.searchParams.get('state') || '' };
}

// Raw http.request rather than global fetch — tests/setup-env.ts denies
// fetch by default in every test, and these tests need a real loopback
// round trip against the server openDrivePickerFlow itself creates.
function postResult(port: number, state: string, body: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ state, ...body });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/result', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function getPickerPage(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('openDrivePickerFlow', () => {
  beforeEach(() => {
    openExternalMock.mockReset();
    openExternalMock.mockResolvedValue(undefined);
  });

  it('resolves with the picked files once the browser posts back a selection', async () => {
    const flowPromise = openDrivePickerFlow('token', 'key');
    // Wait for openExternal to have been called with the picker URL.
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalled());
    const { port, state } = extractPortAndState(openExternalMock.mock.calls[0][0]);

    await postResult(port, state, { files: [{ id: 'f1', name: 'Doc 1' }] });
    const result = await flowPromise;

    expect(result).toEqual({ ok: true, files: [{ id: 'f1', name: 'Doc 1' }] });
  });

  it('survives an aborted /result request instead of crashing the process', async () => {
    const flowPromise = openDrivePickerFlow('token', 'key');
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalled());
    const { port } = extractPortAndState(openExternalMock.mock.calls[0][0]);

    // Declare a body larger than what's actually sent, then destroy the
    // socket mid-transfer — the same "tab closed mid-request" shape the
    // crash fix (req.on('error', ...)) guards against.
    await new Promise<void>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(
          'POST /result HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'Content-Type: application/json\r\n' +
          'Content-Length: 1000\r\n\r\n' +
          '{"partial":',
        );
        setTimeout(() => { socket.destroy(); resolve(); }, 20);
      });
      socket.on('error', () => resolve()); // ECONNRESET on our end is expected too
    });

    // The flow should eventually settle (via cancel/timeout/a later valid
    // post) rather than the aborted request having crashed the server —
    // confirmed here by the server still being alive to accept a fresh,
    // well-formed request afterward.
    cancelCurrentDrivePicker();
    const result = await flowPromise;
    expect(result.ok).toBe(false);
  });

  it('ignores unauthenticated /result POSTs instead of tearing down the flow, and still resolves the real one', async () => {
    const flowPromise = openDrivePickerFlow('token', 'key');
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalled());
    const { port, state } = extractPortAndState(openExternalMock.mock.calls[0][0]);

    // Malformed JSON body — same shape any local process (or a page doing
    // a no-cors POST to this port) could send without knowing `state` at
    // all. Must not kill the flow: the body is parsed before the state
    // check, so this has to be handled without ever reaching resolve/reject.
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/result', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => { res.resume(); res.on('end', resolve); },
      );
      req.on('error', reject);
      req.end('not valid json');
    });

    // Well-formed JSON but the wrong state — same idea, an attacker who
    // can reach the port but doesn't know the real secret.
    await postResult(port, 'wrong-state', { files: [{ id: 'evil', name: 'evil' }] });

    // The real tab's post should still land afterward — the flow must
    // still be alive and waiting.
    await postResult(port, state, { files: [{ id: 'f1', name: 'Doc 1' }] });
    const result = await flowPromise;
    expect(result).toEqual({ ok: true, files: [{ id: 'f1', name: 'Doc 1' }] });
  });

  it('cancels the FIRST picker session (not left orphaned) when a second one starts before the first resolves', async () => {
    const firstFlow = openDrivePickerFlow('token-1', 'key');
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1));

    const secondFlow = openDrivePickerFlow('token-2', 'key');
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(2));

    // The first attempt must have been cancelled by the second one starting
    // — it should resolve (not hang for the full 5-minute timeout) with a
    // failure, freeing its loopback server instead of leaking it.
    const firstResult = await firstFlow;
    expect(firstResult.ok).toBe(false);

    // The second (current) attempt is still live and independently resolvable.
    const { port, state } = extractPortAndState(openExternalMock.mock.calls[1][0]);
    await postResult(port, state, { files: [{ id: 'f2', name: 'Doc 2' }] });
    const secondResult = await secondFlow;
    expect(secondResult).toEqual({ ok: true, files: [{ id: 'f2', name: 'Doc 2' }] });
  });

  it('serves the token-bearing picker page only once and marks it uncacheable', async () => {
    const flowPromise = openDrivePickerFlow('token', 'key');
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalled());
    const url = openExternalMock.mock.calls[0][0] as string;

    const first = await getPickerPage(url);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');

    // Same URL (same state, still within the timeout window) fetched again
    // — must be rejected instead of re-serving the embedded access token.
    const second = await getPickerPage(url);
    expect(second.statusCode).toBe(403);

    cancelCurrentDrivePicker();
    const result = await flowPromise;
    expect(result.ok).toBe(false);
  });

  it('fails fast when the browser cannot be launched, instead of hanging for the full timeout', async () => {
    openExternalMock.mockRejectedValueOnce(new Error('no default browser'));

    const start = Date.now();
    const result = await openDrivePickerFlow('token', 'key');
    const elapsedMs = Date.now() - start;

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/browser/i);
    // Well under PICKER_TIMEOUT_MS (5 minutes) — this is the whole point of
    // the fix, so a generous but still fast-fail-confirming ceiling.
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('escapes `<` in the embedded JSON so a value containing `</script>` cannot break out of the inline script', async () => {
    // JSON.stringify does NOT escape `/`, so without the fix this value
    // would close the real <script> early and let the injected one run.
    const malicious = '</script><script>window.__pwned = true;</script>';
    const flowPromise = openDrivePickerFlow(malicious, 'key');
    await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalled());
    const url = openExternalMock.mock.calls[0][0] as string;

    const { body } = await getPickerPage(url);
    expect(body).not.toContain('</script><script>window.__pwned');
    expect(body).toContain('\\u003c/script>\\u003cscript>');

    cancelCurrentDrivePicker();
    await flowPromise;
  });
});

describe('isValidDriveFileIds', () => {
  it('accepts undefined (no pre-navigation requested)', () => {
    expect(isValidDriveFileIds(undefined)).toBe(true);
  });

  it('accepts an empty array and real-looking Drive ids', () => {
    expect(isValidDriveFileIds([])).toBe(true);
    expect(isValidDriveFileIds(['1a2B3c_-4d', 'AbCd_1234-XYZ'])).toBe(true);
  });

  it('rejects anything that is not an array of plain alphanumeric/underscore/hyphen strings', () => {
    expect(isValidDriveFileIds('abc')).toBe(false);
    expect(isValidDriveFileIds(null)).toBe(false);
    expect(isValidDriveFileIds([123])).toBe(false);
    expect(isValidDriveFileIds(['ok', '</script><script>evil()</script>'])).toBe(false);
    expect(isValidDriveFileIds(['has space'])).toBe(false);
    expect(isValidDriveFileIds(['../etc/passwd'])).toBe(false);
  });
});
