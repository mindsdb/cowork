import { afterEach, describe, expect, it, vi } from 'vitest';

import { gateMindsResponseCreationRequest } from './minds-response-request-gate';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('response-creation resume gate', () => {
  const runtimeCredentialRequired = async () => true;

  it('waits for readiness before forwarding a new response request', async () => {
    let release!: (ready: boolean) => void;
    const waitUntilReady = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const forward = vi.fn();

    expect(gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
      8765,
      true,
      runtimeCredentialRequired,
      waitUntilReady,
      forward,
    )).toBe(true);
    expect(forward).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(waitUntilReady).toHaveBeenCalledTimes(1));
    release(true);
    await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(true));
  });

  it('tells the caller to abort when readiness resolves false', async () => {
    const forward = vi.fn();
    gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://localhost:8765/api/v1/responses/' },
      8765,
      true,
      runtimeCredentialRequired,
      async () => false,
      forward,
    );

    await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(false));
  });

  it('does not gate other loopback traffic or response reads', () => {
    const waitUntilReady = vi.fn(async () => true);
    const forward = vi.fn();
    const requests = [
      { method: 'GET', url: 'http://127.0.0.1:8765/api/v1/responses/response-1' },
      { method: 'GET', url: 'http://127.0.0.1:8765/api/v1/health/' },
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/settings/MINDS_API_KEY' },
      { method: 'POST', url: 'http://127.0.0.1:9999/api/v1/responses' },
    ];

    for (const request of requests) {
      expect(gateMindsResponseCreationRequest(
        request,
        8765,
        true,
        runtimeCredentialRequired,
        waitUntilReady,
        forward,
      )).toBe(false);
    }
    expect(waitUntilReady).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it('does not touch response creation when no resume barrier is active', () => {
    const waitUntilReady = vi.fn(async () => true);
    const forward = vi.fn();

    expect(gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
      8765,
      false,
      runtimeCredentialRequired,
      waitUntilReady,
      forward,
    )).toBe(false);
    expect(waitUntilReady).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it('forwards a direct-provider turn without waiting for the runtime credential', async () => {
    const waitUntilReady = vi.fn(() => new Promise<boolean>(() => {}));
    const forward = vi.fn();

    expect(gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
      8765,
      true,
      async () => false,
      waitUntilReady,
      forward,
    )).toBe(true);

    await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(true));
    expect(waitUntilReady).not.toHaveBeenCalled();
  });

  it.each([null, true])(
    'keeps the runtime-credential wait when the sidecar requirement is %s',
    async (required) => {
      const waitUntilReady = vi.fn(async () => false);
      const forward = vi.fn();

      gateMindsResponseCreationRequest(
        { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
        8765,
        true,
        async () => required,
        waitUntilReady,
        forward,
      );

      await vi.waitFor(() => expect(waitUntilReady).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(false));
    },
  );

  it('counts the sidecar probe inside the 25-second request bound', async () => {
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValue(13_000);
    const waitUntilReady = vi.fn(async () => false);
    const forward = vi.fn();

    gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
      8765,
      true,
      async () => true,
      waitUntilReady,
      forward,
    );

    await vi.waitFor(() => expect(waitUntilReady).toHaveBeenCalledWith(22_000));
    now.mockRestore();
  });

  it('aborts at 25 seconds even when the sidecar requirement probe hangs', async () => {
    vi.useFakeTimers();
    const waitUntilReady = vi.fn(async () => true);
    const forward = vi.fn();

    gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
      8765,
      true,
      () => new Promise<boolean | null>(() => {}),
      waitUntilReady,
      forward,
    );

    await vi.advanceTimersByTimeAsync(24_999);
    expect(forward).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(forward).toHaveBeenCalledWith(false);
    expect(waitUntilReady).not.toHaveBeenCalled();
  });

  it('keeps the runtime-credential wait when the sidecar probe fails', async () => {
    const waitUntilReady = vi.fn(async () => false);
    const forward = vi.fn();

    gateMindsResponseCreationRequest(
      { method: 'POST', url: 'http://127.0.0.1:8765/api/v1/responses' },
      8765,
      true,
      async () => { throw new Error('sidecar unavailable'); },
      waitUntilReady,
      forward,
    );

    await vi.waitFor(() => expect(waitUntilReady).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(forward).toHaveBeenCalledWith(false));
  });
});
