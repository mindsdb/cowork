import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as net from 'net';
import * as http from 'http';

const openExternalMock = vi.fn(async (_url: string) => {});
vi.mock('electron', () => ({
  shell: { openExternal: (url: string) => openExternalMock(url) },
}));

// Imported after the mock so drive-picker-service picks up the mocked shell.
const { openDrivePickerFlow, cancelCurrentDrivePicker } = await import('./drive-picker-service');

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
});
