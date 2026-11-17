import { afterEach, describe, expect, it, vi } from 'vitest';

// MINDS_VIEW_URL is resolved at import time, so each test stubs the
// environment first and imports a fresh copy.
async function importViewSession() {
  vi.resetModules();
  return await import('./viewSession');
}

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setUrl('http://localhost:3000/');
});

describe('endViewSession', () => {
  it('asks the environment view host to clear its session cookie', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { endViewSession } = await importViewSession();

    await endViewSession();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://view.staging.mindshub.ai/_session/end');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' });
    expect(init.body).toBeUndefined();
  });

  it('sends nothing from a plain http origin such as local vite dev', async () => {
    setUrl('http://localhost:3000/');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { endViewSession } = await importViewSession();

    await endViewSession();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing from a page that is not next to the view host', async () => {
    // A self-hosted Cowork web that signs in to MindsHub: another site.
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.mindshub.ai');
    setUrl('https://cowork.customer.example/');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { endViewSession } = await importViewSession();

    await endViewSession();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reaches the view host of a PR environment from its Cowork web', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork-pr-cowork-744.dev.mindshub.ai/');
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { endViewSession } = await importViewSession();

    await endViewSession();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://view-pr-cowork-744.dev.mindshub.ai/_session/end',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('settles with a warning when the view host cannot be reached or refuses', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { endViewSession } = await importViewSession();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(endViewSession()).resolves.toBeUndefined();
    expect(warn).toHaveBeenLastCalledWith('Could not end the artifact viewer session (TypeError).');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    await expect(endViewSession()).resolves.toBeUndefined();
    expect(warn).toHaveBeenLastCalledWith('Could not end the artifact viewer session (HTTP 403).');
  });

  it('stays quiet when the view host clears the session', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    const { endViewSession } = await importViewSession();

    await endViewSession();

    expect(warn).not.toHaveBeenCalled();
  });

  it('gives up on a view host that does not answer', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { endViewSession, VIEW_SESSION_END_TIMEOUT_MS } = await importViewSession();
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));

    const pending = endViewSession();
    await vi.advanceTimersByTimeAsync(VIEW_SESSION_END_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(warn).toHaveBeenCalledWith('Could not end the artifact viewer session (AbortError).');
  });
});
