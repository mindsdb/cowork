import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const embedBrowser = vi.fn();
vi.mock('../../api', () => ({ embedBrowser: (...args) => embedBrowser(...args) }));

import { BrowserPanel, STARTING_TIMEOUT_MS, webPaneNote } from './BrowserPanel';
import { QUICK_CLOSE_MS } from '../../lib/browserSession';

const VIEW = `${window.location.origin}/browser/sessions/t-abc/view?et=tok`;
import embedAnswer from '../../__fixtures__/browser-router/embed_answer.json';

const TICKET_EXPIRES = 1_900_000_000;
const link = (n = 1) => ({
  session_id: 't-abc',
  view_url: `${VIEW}${n}`,
  ticket_expires_at: TICKET_EXPIRES,
  lease_expires_at: TICKET_EXPIRES + 780,
});

let visibility = 'visible';

function setVisibility(state) {
  visibility = state;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

/* happy-dom loads no page into the frame here, so it has no window of its
   own: give it one the test can see messages go to and come from. */
function frameWindow() {
  const frame = screen.getByTitle('Shared browser');
  if (!frame.__testWindow) {
    const win = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win });
    frame.__testWindow = win;
  }
  return frame.__testWindow;
}

function messageFrom(source, data) {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, source })); });
}

async function flush() {
  await act(async () => {});
}

describe('BrowserPanel', () => {
  // The frames point at a live host: keep happy-dom from loading them, so
  // the tests decide when a frame has loaded.
  let iframeLoading;
  beforeEach(() => {
    vi.useFakeTimers();
    embedBrowser.mockReset();
    embedBrowser.mockResolvedValue(link());
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete document.visibilityState;
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
  });

  describe('starting state', () => {
    it('says where what the person types, and the page, go', async () => {
      render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={() => {}} />);
      await flush();
      expect(screen.getByText(webPaneNote('Cowork'))).toBeInTheDocument();
      expect(webPaneNote('Cowork')).toMatch(/passwords included, passes through Cloudflare and MindsDB's browser service/);
    });

    it("frames the link in the router's own embed answer", async () => {
      // cowork-server's fixture, on this page's origin: the pane reads the
      // fields the router sends, ticket_expires_at and lease_expires_at.
      const { body } = embedAnswer.examples['a viewer link'];
      const fromThisApp = body.view_url.replace(new URL(body.view_url).origin, window.location.origin);
      embedBrowser.mockResolvedValue({ ...body, view_url: fromThisApp });
      render(<BrowserPanel sessionId={body.session_id} onClose={() => {}} />);
      await flush();
      expect(embedBrowser).toHaveBeenCalledWith(body.session_id);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', fromThisApp);
      expect(screen.queryByText('The browser returned an unexpected address.')).toBeNull();
    });

    it('mints a link on open and says the browser is starting until the viewer says it is ready', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      await flush();
      expect(embedBrowser).toHaveBeenCalledWith('t-abc');
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}1`);
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps waiting through a frame load with no viewer, then offers to try again', async () => {
      // The router's starting page, a JSON refusal for an expired link, or an
      // edge error page: each loads the frame and never says it is ready.
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      fireEvent.load(screen.getByTitle('Shared browser'));
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS); });
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it("ignores a ready message that isn't from its own frame", async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      frameWindow();
      messageFrom({ postMessage: vi.fn() }, { type: 'browser-viewer-ready' });
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
    });

    it('offers to try again when the browser takes too long, and retrying starts over', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS - 1); });
      expect(screen.queryByText(/taking longer than usual/)).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();

      embedBrowser.mockResolvedValue(link(2));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
      expect(screen.getByText('Starting your browser…')).toBeInTheDocument();
    });

    it('shows the error, not the starting state, when the mint fails', async () => {
      embedBrowser.mockRejectedValue(new Error('No capacity right now.'));
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(screen.getByText('No capacity right now.')).toBeInTheDocument();
      expect(screen.queryByText('Starting your browser…')).toBeNull();
    });

    it('refuses a minted link with no redeem-by time', async () => {
      embedBrowser.mockResolvedValue({ ...link(), ticket_expires_at: 0 });
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(screen.getByText('The browser returned an unexpected address.')).toBeInTheDocument();
    });
  });

  describe('the frame', () => {
    it('is sandboxed without allow-same-origin', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('sandbox', 'allow-forms allow-scripts');
    });

    it('sends the theme to the frame\'s own window when it loads and when the viewer asks', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      const win = frameWindow();
      fireEvent.load(screen.getByTitle('Shared browser'));
      expect(win.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-theme' }), '*');
      win.postMessage.mockClear();
      messageFrom(win, { type: 'browser-viewer-ready' });
      expect(win.postMessage).toHaveBeenCalledTimes(1);
    });

    it('offers no way to open the viewer link in a window', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(screen.queryByRole('button', { name: /open browser in a window/i })).toBeNull();
    });
  });

  describe('fresh links', () => {
    it('never mints on a timer', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      await act(async () => { vi.advanceTimersByTime(2 * 60 * 60_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it('drops the frame while the tab is hidden, and mints a new link when it is visible again', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      setVisibility('hidden');
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(embedBrowser).toHaveBeenCalledTimes(1);

      embedBrowser.mockResolvedValue(link(2));
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
    });

    it('opens no frame for a link that arrives after the tab hid', async () => {
      let resolve;
      embedBrowser.mockReturnValue(new Promise((r) => { resolve = r; }));
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      setVisibility('hidden');
      await act(async () => { resolve(link()); });
      expect(screen.queryByTitle('Shared browser')).toBeNull();
    });

    it('mints nothing while opened in a hidden tab, until it is visible', async () => {
      visibility = 'hidden';
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(embedBrowser).not.toHaveBeenCalled();
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it('mints a new link when the network comes back', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      embedBrowser.mockResolvedValue(link(2));
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
    });

    it('mints a new link when its own viewer reports a close, and ignores other windows', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      const win = frameWindow();
      messageFrom({ postMessage: vi.fn() }, { type: 'browser-viewer-closed', code: 4401 });
      messageFrom(null, { type: 'browser-viewer-closed', code: 4401 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(1);

      embedBrowser.mockResolvedValue(link(2));
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      messageFrom(win, { type: 'browser-viewer-closed', code: 4401 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
    });

    it('stops asking after a second quick close in a row, until the person tries again', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 1006 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 1006 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/keeps closing/)).toBeInTheDocument();

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
      expect(embedBrowser).toHaveBeenCalledTimes(3);
      expect(screen.getByTitle('Shared browser')).toBeInTheDocument();
    });
  });
});
