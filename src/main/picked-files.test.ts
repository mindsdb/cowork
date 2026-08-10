import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// picked-files transitively imports server-process → credential-provisioning
// (ENG-1241) → keychain-service, which loads the native `keytar` module at
// import time — fine on macOS/Windows, but it requires libsecret on Linux,
// which CI's runner doesn't have. Mocked here purely to make the import chain
// safe; this suite never calls anything credential-related.
vi.mock('./credential-provisioning', () => ({
  loadBundledServerCredentials: vi.fn().mockResolvedValue({}),
}));

import { verifyPickedFiles, getPickedFiles, savePickedFiles, type PickedFile } from './picked-files';

function fakeResponse(ok: boolean, body: unknown = {}, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('getPickedFiles', () => {
  beforeEach(() => {
    // authHeader() transitively calls cowork-home.ts's buildKind(), which
    // touches Electron's `app.isPackaged` unless COWORK_BUILD_KIND short-
    // circuits it first — `app` isn't available/mocked in this node-env
    // test, so without this every call here throws (silently swallowed by
    // getPickedFiles' own try/catch, masking the fetch-mock assertions
    // below with a false-negative empty array).
    process.env.COWORK_BUILD_KIND = 'dev';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads files from the _picked_files field (regression guard for the picked_files rename)', async () => {
    const files: PickedFile[] = [{ id: 'f1', name: 'Doc 1' }];
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(true, { fields: { _picked_files: JSON.stringify(files) } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await getPickedFiles('google_drive', 'me@example.com');
    expect(result).toEqual(files);
  });

  it('does NOT fall back to the old picked_files key — a record only carrying the old key returns empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(true, { fields: { picked_files: JSON.stringify([{ id: 'f1', name: 'Doc 1' }]) } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await getPickedFiles('google_drive', 'me@example.com');
    expect(result).toEqual([]);
  });

  it('returns an empty list when the field is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(true, { fields: {} }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await getPickedFiles('google_drive', 'me@example.com')).toEqual([]);
  });

  it('returns an empty list on a non-ok response instead of throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(false));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await getPickedFiles('google_drive', 'me@example.com')).toEqual([]);
  });

  it('returns an empty list on malformed JSON instead of throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(true, { fields: { _picked_files: 'not json' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await getPickedFiles('google_drive', 'me@example.com')).toEqual([]);
  });
});

describe('savePickedFiles', () => {
  beforeEach(() => {
    process.env.COWORK_BUILD_KIND = 'dev';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:true with the server-merged list on success', async () => {
    const merged: PickedFile[] = [{ id: 'f1', name: 'Doc 1' }, { id: 'f2', name: 'Doc 2' }];
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(true, { files: merged }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await savePickedFiles('google_drive', 'me@example.com', [{ id: 'f2', name: 'Doc 2' }]);
    expect(result).toEqual({ ok: true, files: merged });
  });

  // Regression: this used to silently return the (unpersisted) input list
  // on failure, so the caller couldn't tell the PATCH never landed and
  // reported success to the renderer anyway.
  it('returns ok:false (not the unpersisted input) on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(false, {}, 500));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const newFiles: PickedFile[] = [{ id: 'f3', name: 'Doc 3' }];
    const result = await savePickedFiles('google_drive', 'me@example.com', newFiles);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/500/);
  });

  it('returns ok:false (not the unpersisted input) when the request throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const newFiles: PickedFile[] = [{ id: 'f4', name: 'Doc 4' }];
    const result = await savePickedFiles('google_drive', 'me@example.com', newFiles);
    expect(result).toEqual({ ok: false, reason: 'network down' });
  });
});

describe('verifyPickedFiles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies a file that is readable on the first check — no retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(true));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const file: PickedFile = { id: 'f1', name: 'Doc 1' };
    const resultPromise = verifyPickedFiles('token', [file]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ verified: [file], failed: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff and succeeds once Google catches up (replication-lag case)', async () => {
    const notFound = fakeResponse(false, { error: { errors: [{ reason: 'notFound' }] } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(fakeResponse(true));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const file: PickedFile = { id: 'f2', name: 'Doc 2' };
    const resultPromise = verifyPickedFiles('token', [file]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ verified: [file], failed: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after exhausting all retries and reports the failure reason', async () => {
    const denied = fakeResponse(false, { error: { errors: [{ reason: 'appNotAuthorizedToFile' }] } });
    const fetchMock = vi.fn().mockResolvedValue(denied);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const file: PickedFile = { id: 'f3', name: 'Doc 3', resourceKey: 'rk-abc' };
    const resultPromise = verifyPickedFiles('token', [file]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.verified).toEqual([]);
    expect(result.failed).toEqual([
      { id: 'f3', name: 'Doc 3', reason: 'appNotAuthorizedToFile, has resourceKey' },
    ]);
    // Initial check + 3 backoff retries = 4 total calls.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('distinguishes "no resourceKey" from "has resourceKey" in the failure reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(false, { error: { errors: [{ reason: 'notFound' }] } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const file: PickedFile = { id: 'f4', name: 'Doc 4' }; // no resourceKey
    const resultPromise = verifyPickedFiles('token', [file]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.failed[0].reason).toBe('notFound, no resourceKey');
  });

  it('verifies a batch of files independently — one failing does not affect the others', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('good-file')
          ? fakeResponse(true)
          : fakeResponse(false, { error: { errors: [{ reason: 'notFound' }] } }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const files: PickedFile[] = [
      { id: 'good-file', name: 'Good' },
      { id: 'bad-file', name: 'Bad' },
    ];
    const resultPromise = verifyPickedFiles('token', files);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.verified).toEqual([files[0]]);
    expect(result.failed).toEqual([{ id: 'bad-file', name: 'Bad', reason: 'notFound, no resourceKey' }]);
  });
});
