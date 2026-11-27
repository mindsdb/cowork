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

describe('publishedFrameCredential', () => {
  const LK = 'k3m7q2xwp6n4tahd5rzc2bvy7e';
  const PAGE = `https://view.staging.mindshub.ai/a/${LK}/`;
  const ORIGIN = 'https://f5h8n2w6-staging.mindshub.co';
  const token = async () => 'kc-token';
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  function onStaging(answer: Response | (() => never)) {
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const fetchMock = vi.fn(async () => (typeof answer === 'function' ? answer() : answer));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('trades the token, in the POST body only, for the frame credential', async () => {
    const fetchMock = onStaging(json({ origin: ORIGIN, credential: 'v1.p.s', exp: 1_900_000_000 }));
    const { publishedFrameCredential } = await importViewSession();

    expect(await publishedFrameCredential(PAGE, token)).toEqual({ origin: ORIGIN, credential: 'v1.p.s', exp: 1_900_000_000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://view.staging.mindshub.ai/a/${LK}/_cowork_token`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ token: 'kc-token' });
  });

  it('passes a public app its link key, which does not expire', async () => {
    onStaging(json({ origin: ORIGIN, credential: LK, exp: null }));
    const { publishedFrameCredential } = await importViewSession();
    expect(await publishedFrameCredential(PAGE, token)).toEqual({ origin: ORIGIN, credential: LK, exp: null });
  });

  it('asks for an update, and sends nothing, for an address without a link key', async () => {
    const fetchMock = onStaging(json({}));
    const { publishedFrameCredential } = await importViewSession();
    const legacy = 'https://view.staging.mindshub.ai/a/c0ffee00c0ffee00c0ffee00c0ffee00';
    expect(await publishedFrameCredential(legacy, token)).toEqual({ error: 'update_needed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing for another host, another shape, no token, or a page off the view host', async () => {
    const fetchMock = onStaging(json({}));
    const { publishedFrameCredential } = await importViewSession();
    for (const other of [
      `https://view.mindshub.ai/a/${LK}/`,
      `https://view.staging.mindshub.ai.evil.example/a/${LK}/`,
      `http://view.staging.mindshub.ai/a/${LK}/`,
      'https://view.staging.mindshub.ai/view/8620653c9/b527cf6e',
      'not a url',
    ]) {
      expect(await publishedFrameCredential(other, token)).toEqual({ error: 'unavailable' });
    }
    expect(await publishedFrameCredential(PAGE, async () => null)).toEqual({ error: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();

    setUrl('http://localhost:3000/');
    const local = await importViewSession();
    expect(await local.publishedFrameCredential(PAGE, token)).toEqual({ error: 'unavailable' });
  });

  it.each([
    [json({ error: 'Forbidden', reason: 'no_access' }, 403), 'no_access'],
    [json({ error: 'Forbidden', reason: 'password' }, 403), 'password'],
    [json({ error: 'Forbidden' }, 403), 'unavailable'],
    [json({ error: 'Invalid JWT' }, 401), 'retry'],
    [json({ error: 'rate-limited' }, 429), 'retry'],
    [json({ error: 'unavailable' }, 503), 'retry'],
    [new Response('<html>', { status: 500 }), 'retry'],
    [json({ error: 'Bad gateway' }, 502), 'retry'],
    [new Response('', { status: 504 }), 'retry'],
    [json({ error: 'Not found' }, 404), 'unavailable'],
  ])('maps an answer to its reason (%#)', async (answer, reason) => {
    onStaging(answer as Response);
    const { publishedFrameCredential } = await importViewSession();
    expect(await publishedFrameCredential(PAGE, token)).toEqual({ error: reason });
  });

  it('retries after a network error, a timeout or a refused preflight', async () => {
    onStaging(() => { throw new TypeError('Failed to fetch'); });
    const { publishedFrameCredential } = await importViewSession();
    expect(await publishedFrameCredential(PAGE, token)).toEqual({ error: 'retry' });
  });

  it('passes the caller signal to the request, so aborting it cancels the POST', async () => {
    const fetchMock = onStaging(json({ origin: ORIGIN, credential: 'v1.p.s', exp: null }));
    const { publishedFrameCredential } = await importViewSession();
    const controller = new AbortController();
    await publishedFrameCredential(PAGE, token, controller.signal);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal?.aborted).toBe(false);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('answers an aborted request as a network error, with no frame', async () => {
    onStaging(() => { throw new DOMException('Aborted', 'AbortError'); });
    const { publishedFrameCredential } = await importViewSession();
    const controller = new AbortController();
    controller.abort();
    expect(await publishedFrameCredential(PAGE, token, controller.signal)).toEqual({ error: 'retry' });
  });

  it('retries, and sends nothing, when the token refresh fails', async () => {
    const fetchMock = onStaging(json({}));
    const { publishedFrameCredential } = await importViewSession();
    const failing = async () => { throw new Error('refresh failed'); };
    expect(await publishedFrameCredential(PAGE, failing)).toEqual({ error: 'retry' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://draft-staging.mindshub.co', credential: 'v1.p.s', exp: 1 },
    { origin: 'https://f5h8n2w6-staging.mindshub.co.evil.example', credential: 'v1.p.s', exp: 1 },
    { origin: 'http://f5h8n2w6-staging.mindshub.co', credential: 'v1.p.s', exp: 1 },
    { origin: `${ORIGIN}/x`, credential: 'v1.p.s', exp: 1 },
    { origin: ORIGIN, credential: '../x', exp: 1 },
    { origin: ORIGIN, credential: '..', exp: 1 },
    { origin: ORIGIN, credential: '.', exp: 1 },
    { origin: ORIGIN, credential: '', exp: 1 },
    { origin: ORIGIN, credential: 'v1.p.s', exp: 'soon' },
  ])('frames nothing it can not trust: %o', async (body) => {
    onStaging(json(body));
    const { publishedFrameCredential } = await importViewSession();
    expect(await publishedFrameCredential(PAGE, token)).toEqual({ error: 'unavailable' });
  });
});

describe('artifactHostOrigin', () => {
  it.each([
    ['https://f5h8n2w6.mindshub.co', 'https://f5h8n2w6.mindshub.co'],
    ['https://f5h8n2w6-staging.mindshub.co', 'https://f5h8n2w6-staging.mindshub.co'],
    ['https://draft.mindshub.co', ''],
    ['https://draft-dev.mindshub.co', ''],
    ['https://cowork.staging.mindshub.ai', ''],
    ['https://f5h8n2w6.mindshub.co:8443', ''],
    [undefined, ''],
  ])('%s → %s', async (value, expected) => {
    const { artifactHostOrigin } = await importViewSession();
    expect(artifactHostOrigin(value)).toBe(expected);
  });
});
