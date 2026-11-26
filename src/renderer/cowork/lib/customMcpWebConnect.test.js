import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginCustomMcpSignIn,
  cancelCustomMcpSignIn,
  CUSTOM_MCP_SIGN_IN_CHANNEL,
  customMcpFailure,
  endCustomMcpSignIn,
  openLoginPage,
  pollCustomMcpSignIn,
  readFinishReport,
  reportCustomMcpFinish,
  toolsFrom,
} from './customMcpWebConnect';

function fakeWindow() {
  const popup = { opener: 'the Cowork tab', location: { href: '' }, close: vi.fn() };
  // The address is set through location.href; record what the opener was then.
  let openerWhenAddressed;
  Object.defineProperty(popup.location, 'href', {
    get: () => popup.address || '',
    set: (value) => { openerWhenAddressed = popup.opener; popup.address = value; },
  });
  return { win: { open: vi.fn(() => popup) }, popup, openerWhenAddressed: () => openerWhenAddressed };
}

afterEach(() => {
  cancelCustomMcpSignIn();
});

describe('the sign-in pop-up', () => {
  it('opens at once and has no opener before its address is set', async () => {
    const { win, popup, openerWhenAddressed } = fakeWindow();

    const signIn = beginCustomMcpSignIn(win);
    expect(win.open).toHaveBeenCalledWith('', '_blank');
    expect(openLoginPage(signIn, 'https://auth.example.com/authorize?state=s')).toEqual({ ok: true });

    expect(popup.location.href).toBe('https://auth.example.com/authorize?state=s');
    expect(openerWhenAddressed()).toBeNull();
    expect(popup.close).not.toHaveBeenCalled();
  });

  it.each(['http://auth.example.com/authorize', 'javascript:alert(1)', 'not a url', 42])(
    'closes the pop-up and opens nothing for %s',
    (authUrl) => {
      const { win, popup } = fakeWindow();

      const signIn = beginCustomMcpSignIn(win);
      expect(openLoginPage(signIn, authUrl)).toEqual({ ok: false, code: 'insecure_login_url', reason: '' });

      expect(popup.close).toHaveBeenCalled();
      expect(popup.location.href).toBe('');
    },
  );

  it('refuses at once when the browser blocked the pop-up', () => {
    const win = { open: vi.fn(() => null) };
    const signIn = beginCustomMcpSignIn(win);

    expect(openLoginPage(signIn, 'https://auth.example.com/a')).toEqual({ ok: false, code: 'popup_blocked', reason: '' });
    expect(win.open).toHaveBeenCalledTimes(1);
  });

  it('refuses when the member closed the pop-up before the login page was known', () => {
    const { win, popup } = fakeWindow();
    const signIn = beginCustomMcpSignIn(win);
    popup.closed = true;

    expect(openLoginPage(signIn, 'https://auth.example.com/a')).toEqual({ ok: false, code: 'popup_blocked', reason: '' });
    expect(popup.location.href).toBe('');
  });
});

describe('the status poll', () => {
  const sleepNow = () => Promise.resolve();

  it('sends no request while one is in flight', async () => {
    vi.useFakeTimers();
    try {
      const signIn = beginCustomMcpSignIn({ open: () => null });
      let answerFirst;
      const readStatus = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
        .mockResolvedValueOnce({ ok: true, data: { status: 'success', name: 'cm-1' } });

      const polling = pollCustomMcpSignIn(signIn, readStatus);
      await vi.advanceTimersByTimeAsync(3000);
      expect(readStatus).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(readStatus).toHaveBeenCalledTimes(1);

      answerFirst({ ok: true, data: { status: 'pending' } });
      await vi.advanceTimersByTimeAsync(3000);
      expect(readStatus).toHaveBeenCalledTimes(2);
      expect(await polling).toEqual({ ok: true, data: { status: 'success', name: 'cm-1' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a poll that timed out and stops on refused', async () => {
    const signIn = beginCustomMcpSignIn({ open: () => null });
    const readStatus = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'timeout', reason: '' })
      .mockResolvedValueOnce({ ok: true, data: { status: 'refused' } });

    expect(await pollCustomMcpSignIn(signIn, readStatus, { sleep: sleepNow })).toEqual({ ok: false, code: 'refused', reason: '' });
    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  it.each(['http_429', 'http_502', 'http_503', 'http_504'])('keeps polling after %s', async (code) => {
    const signIn = beginCustomMcpSignIn({ open: () => null });
    const readStatus = vi.fn()
      .mockResolvedValueOnce({ ok: false, code, reason: 'auth service unreachable' })
      .mockResolvedValueOnce({ ok: true, data: { status: 'success', name: 'cm-1' } });

    expect(await pollCustomMcpSignIn(signIn, readStatus, { sleep: sleepNow })).toEqual({ ok: true, data: { status: 'success', name: 'cm-1' } });
    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  it('stops on a refusal that is not transient', async () => {
    const signIn = beginCustomMcpSignIn({ open: () => null });
    const readStatus = vi.fn().mockResolvedValue({ ok: false, code: 'http_404', reason: 'Not found.' });

    expect(await pollCustomMcpSignIn(signIn, readStatus, { sleep: sleepNow })).toEqual({ ok: false, code: 'http_404', reason: 'Not found.' });
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  it('gives up on a status that stays transient at the overall deadline', async () => {
    const signIn = beginCustomMcpSignIn({ open: () => null });
    let clock = 0;
    const readStatus = vi.fn(async () => {
      clock += 60_000;
      return { ok: false, code: 'http_502', reason: '' };
    });

    expect(await pollCustomMcpSignIn(signIn, readStatus, { sleep: sleepNow, now: () => clock })).toEqual({ ok: false, code: 'timeout', reason: '' });
    expect(readStatus).toHaveBeenCalledTimes(10);
  });

  it('ignores the answer of a request that was in flight at Cancel', async () => {
    const { win, popup } = fakeWindow();
    const signIn = beginCustomMcpSignIn(win);
    let answer;
    const readStatus = vi.fn(() => new Promise((resolve) => { answer = resolve; }));

    const polling = pollCustomMcpSignIn(signIn, readStatus, { sleep: sleepNow });
    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledTimes(1));
    cancelCustomMcpSignIn();

    expect(await polling).toMatchObject({ ok: false, code: 'stopped_waiting' });
    expect(popup.close).toHaveBeenCalled();
    answer({ ok: true, data: { status: 'success' } });
    expect(readStatus).toHaveBeenCalledTimes(1);
  });
});

describe("the finish page's report", () => {
  it('reads only a success or a failure with a plain code', () => {
    expect(readFinishReport({ ok: true, name: 'ignored' })).toEqual({ ok: true });
    expect(readFinishReport({ ok: false, code: 'wrong_organization', reason: 'Signed in elsewhere.' }))
      .toEqual({ ok: false, code: 'wrong_organization', reason: 'Signed in elsewhere.' });
    expect(readFinishReport({ ok: false, code: 'no_refresh_token' })).toEqual({ ok: false, code: 'no_refresh_token', reason: '' });
    expect(readFinishReport({ ok: false, code: 'x', reason: 'r'.repeat(900) }).reason).toHaveLength(500);
    for (const other of [null, 'ok', { ok: 'true' }, { ok: false }, { ok: false, code: '<b>' }, { ok: false, code: 'a'.repeat(65) }]) {
      expect(readFinishReport(other)).toBeNull();
    }
  });

  it('reaches the waiting sign-in through the channel, and nothing once it ended', async () => {
    const { win } = fakeWindow();
    const signIn = beginCustomMcpSignIn(win);

    reportCustomMcpFinish({ ok: false, code: 'expired', reason: 'Took too long.' });

    expect(await signIn.whenReported).toEqual({ ok: false, code: 'expired', reason: 'Took too long.' });
    endCustomMcpSignIn(signIn);
    expect(signIn.channel).toBeNull();
  });

  it('posts once and closes its channel, and does nothing without one', () => {
    const posted = [];
    const closed = vi.fn();
    class Channel {
      constructor(name) { this.name = name; }
      postMessage(message) { posted.push([this.name, message]); }
      close() { closed(); }
    }

    reportCustomMcpFinish({ ok: true, id: 'cm-1' }, Channel);
    reportCustomMcpFinish({ ok: false, code: 'expired' }, Channel);
    reportCustomMcpFinish({ ok: true }, undefined);

    expect(posted).toEqual([
      [CUSTOM_MCP_SIGN_IN_CHANNEL, { ok: true }],
      [CUSTOM_MCP_SIGN_IN_CHANNEL, { ok: false, code: 'expired', reason: '' }],
    ]);
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('ends the wait with a reported failure at once and keeps the pop-up open', async () => {
    const { win, popup } = fakeWindow();
    const signIn = beginCustomMcpSignIn(win, undefined);
    const readStatus = vi.fn(async () => ({ ok: true, data: { status: 'pending' } }));
    signIn.whenReported = Promise.resolve({ ok: false, code: 'token_failed', reason: 'The server refused the code.' });

    const ended = await pollCustomMcpSignIn(signIn, readStatus, { sleep: () => new Promise(() => {}) });
    endCustomMcpSignIn(signIn);

    expect(ended).toEqual({ ok: false, code: 'token_failed', reason: 'The server refused the code.' });
    expect(readStatus).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('reads the status at once after a reported success, then keeps the poll pace', async () => {
    const { win } = fakeWindow();
    const signIn = beginCustomMcpSignIn(win, undefined);
    const readStatus = vi.fn(async () => ({ ok: true, data: { status: 'pending' } }));
    signIn.whenReported = Promise.resolve({ ok: true });

    const waiting = pollCustomMcpSignIn(signIn, readStatus, { sleep: () => new Promise(() => {}) });
    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledTimes(1));
    for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();

    // The poll's own sleep never ends here: a second read would mean the report kept waking it.
    expect(readStatus).toHaveBeenCalledTimes(1);
    cancelCustomMcpSignIn();
    expect(await waiting).toMatchObject({ ok: false, code: 'stopped_waiting' });
  });
});

describe('reading cowork-server answers', () => {
  it.each([
    [{ error: 'port', detail: 'The URL names a port.' }, { code: 'port', reason: 'The URL names a port.' }],
    [{ detail: { error: 'listing_too_large' } }, { code: 'listing_too_large', reason: '' }],
    [{ detail: 'custom_mcp_unavailable' }, { code: 'custom_mcp_unavailable', reason: '' }],
    [null, { code: 'http_502', reason: '' }],
  ])('reads the refusal %j', (body, expected) => {
    expect(customMcpFailure(502, body)).toEqual({ ok: false, ...expected });
  });

  it('skips a tool entry that is not an object', () => {
    expect(toolsFrom({ tools_revision: 3, tools: [null, 'search', { name: 'find', allowed: true }] })).toEqual({
      ok: true,
      tools: [{ name: 'find', description: '', readOnly: false, allowed: true, usable: true, reason: null }],
      revision: 3,
    });
  });

  it('keeps a stored list marked stale with its failure code', () => {
    expect(toolsFrom({ tools_revision: 2, stale: true, code: 'upstream_unavailable', tools: [] })).toEqual({
      ok: true, tools: [], revision: 2, stale: true, staleCode: 'upstream_unavailable',
    });
  });
});
