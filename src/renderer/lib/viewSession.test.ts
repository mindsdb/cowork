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

  // A refused origin gets no CORS headers, so fetch rejects with a TypeError,
  // exactly as for a host that cannot be reached.
  it('settles with a warning when the view host refuses or cannot be reached', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { endViewSession } = await importViewSession();

    await expect(endViewSession()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('Could not end the artifact viewer session (TypeError).');
  });

  it('warns with the status of an error answer the page can read', async () => {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 405 })));
    const { endViewSession } = await importViewSession();

    await expect(endViewSession()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('Could not end the artifact viewer session (HTTP 405).');
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
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })));
    const { endViewSession, VIEW_SESSION_END_TIMEOUT_MS } = await importViewSession();

    const pending = endViewSession();
    expect(timeoutSpy).toHaveBeenCalledWith(VIEW_SESSION_END_TIMEOUT_MS);
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));

    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Could not end the artifact viewer session (TimeoutError).');
  });
});

describe('viewSessionFrameUrl', () => {
  const PAGE = 'https://view.staging.mindshub.ai/view/8620653c9/b527cf6e?v=1.0';
  const token = async () => 'kc-token';

  function onStaging(answer: Response | (() => never)) {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const fetchMock = vi.fn(async () => (typeof answer === 'function' ? answer() : answer));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it("frames the view host's bootstrap with a ticket, the token only in the POST body", async () => {
    const fetchMock = onStaging(new Response('{"ticket":"tk.1"}', { status: 200 }));
    const { viewSessionFrameUrl } = await importViewSession();

    const url = await viewSessionFrameUrl(PAGE, token);

    expect(url).toBe(
      'https://view.staging.mindshub.ai/_session?ticket=tk.1&return=%2Fview%2F8620653c9%2Fb527cf6e%3Fv%3D1.0',
    );
    const [ticketUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(ticketUrl).toBe('https://view.staging.mindshub.ai/_session/ticket');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(JSON.parse(String(init.body))).toEqual({ token: 'kc-token' });
    expect(url).not.toContain('kc-token');
  });

  it("never sends the token to a page off this environment's view host", async () => {
    const fetchMock = onStaging(new Response('{"ticket":"tk.1"}', { status: 200 }));
    const { viewSessionFrameUrl } = await importViewSession();

    for (const other of [
      'https://view.mindshub.ai/view/a/b',
      'https://view.staging.mindshub.ai.evil.example/view/a/b',
      'http://view.staging.mindshub.ai/view/a/b',
      'not a url',
    ]) {
      expect(await viewSessionFrameUrl(other, token)).toBe(other);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('frames the page itself when there is no token, or the view host refuses or fails', async () => {
    for (const answer of [
      new Response('{"error":"Forbidden"}', { status: 403 }),
      new Response('{}', { status: 200 }),
      () => { throw new TypeError('network'); },
    ]) {
      onStaging(answer as Response);
      const { viewSessionFrameUrl } = await importViewSession();
      expect(await viewSessionFrameUrl(PAGE, token)).toBe(PAGE);
    }
    const fetchMock = onStaging(new Response('{"ticket":"tk.1"}', { status: 200 }));
    const { viewSessionFrameUrl } = await importViewSession();
    expect(await viewSessionFrameUrl(PAGE, async () => null)).toBe(PAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks nothing from a plain http origin such as local vite dev', async () => {
    setUrl('http://localhost:3000/');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { viewSessionFrameUrl } = await importViewSession();

    expect(await viewSessionFrameUrl(PAGE, token)).toBe(PAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
