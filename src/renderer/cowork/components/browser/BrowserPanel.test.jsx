import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const embedBrowser = vi.fn();
vi.mock('../../api', () => ({ embedBrowser: (...args) => embedBrowser(...args) }));

import { BrowserPanel, START_FADE_MS, STARTING_TIMEOUT_MS, isBlankPage, webPaneNote } from './BrowserPanel';
import { QUICK_CLOSE_MS } from '../../lib/browserSession';
import { WEB_JEV_LINE, WEB_SIGN_INS } from '../../views/settings/BrowserSettingsSection';

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

function messageFrom(source, data, ports) {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, source, ports })); });
}

/* The MessagePort a viewer that takes tickets in place transfers with its
   ready message. */
function fakePort() {
  return { postMessage: vi.fn(), close: vi.fn() };
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
    it('says where the view, what the person types and the page go, and that sign-ins stay', async () => {
      render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={() => {}} />);
      await flush();
      const note = webPaneNote('Cowork');
      // One line under the pane, and the whole note behind it, closed until
      // the person opens it.
      const details = document.querySelector('details.browser-panel__note');
      expect(details).not.toBeNull();
      expect(details.open).toBe(false);
      expect(details.querySelector('summary')).toHaveTextContent(/^Learn what Cowork sees$/);
      expect(within(details).getByText(note)).toBeInTheDocument();
      expect(note).toMatch(/^What this pane shows and what you type here, passwords included, pass through Cloudflare and MindsDB's browser service on their way to and from the site\. /);
      expect(note).toContain("Cowork's page reads and screenshots go to the model provider that serves your turn.");
      // Settings' own lines, so the pane and Settings say the same.
      expect(note).toContain(WEB_JEV_LINE);
      expect(note).toContain(WEB_SIGN_INS);
    });

    it('passes on who holds the browser, from its own viewer only', async () => {
      const onControl = vi.fn();
      render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={() => {}} onControl={onControl} />);
      await flush();
      messageFrom({}, { type: 'browser-viewer-control', holder: 'human', reason: 'stranger' });
      expect(onControl).not.toHaveBeenCalled();
      messageFrom(frameWindow(), { type: 'browser-viewer-control', holder: 'human', reason: 'sign in to Kayak' });
      messageFrom(frameWindow(), { type: 'browser-viewer-control', holder: 'agent' });
      expect(onControl.mock.calls).toEqual([['human', 'sign in to Kayak'], ['agent', '']]);
    });

    it('covers a blank tab with the start page, and gets out of the way once a page opens', async () => {
      const onSend = vi.fn();
      const onOpenUrl = vi.fn(async () => {});
      render(<BrowserPanel sessionId="t-abc" agentLabel="Anton" onClose={() => {}} taskKey="t" onSend={onSend} onOpenUrl={onOpenUrl} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'about:blank' });
      await flush();
      const field = screen.getByLabelText('What to look up');
      fireEvent.change(field, { target: { value: 'flights to Lisbon' } });
      fireEvent.submit(field.closest('form'));
      expect(onSend).toHaveBeenCalledWith('Search the web in the browser for: flights to Lisbon');
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://www.kayak.com/' });
      await flush();
      // It fades out over the page, then goes.
      expect(screen.getByLabelText('What to look up').closest('.browser-panel__blank-over')).toHaveClass('is-leaving');
      await act(async () => { vi.advanceTimersByTime(START_FADE_MS); });
      expect(screen.queryByLabelText('What to look up')).toBeNull();
      expect(isBlankPage('chrome://newtab/')).toBe(true);
      expect(isBlankPage('https://example.com/')).toBe(false);
    });

    it('opened blank, shows the start page at once and keeps the same one through the swap to the viewer', async () => {
      const onSend = vi.fn();
      const { rerender } = render(<BrowserPanel sessionId={null} startBlank agentLabel="Anton" onClose={() => {}} taskKey="t" onSend={onSend} />);
      await flush();
      expect(screen.getByRole('status', { name: 'Opening your browser' })).toBeInTheDocument();
      expect(embedBrowser).not.toHaveBeenCalled();
      const field = screen.getByLabelText('What to look up');
      fireEvent.change(field, { target: { value: 'half typed' } });

      rerender(<BrowserPanel sessionId="t-abc" startBlank agentLabel="Anton" onClose={() => {}} taskKey="t" onSend={onSend} />);
      await flush();
      expect(embedBrowser).toHaveBeenCalledWith('t-abc');
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      await flush();
      // Ready before it says its address: still the blank tab, and the same field.
      expect(screen.queryByRole('status', { name: 'Opening your browser' })).toBeNull();
      expect(screen.getByLabelText('What to look up')).toBe(field);
      expect(field.value).toBe('half typed');
    });

    it("puts a question typed in the viewer's address bar in the composer, never sends it, and hears its own frame only", async () => {
      const onSend = vi.fn();
      const onDraft = vi.fn();
      render(<BrowserPanel sessionId="t-abc" agentLabel="Anton" onClose={() => {}} onSend={onSend} onDraft={onDraft} />);
      await flush();
      messageFrom({}, { type: 'browser-viewer-ask', text: 'stranger' });
      messageFrom(frameWindow(), { type: 'browser-viewer-ask', text: '  ' });
      messageFrom(frameWindow(), { type: 'browser-viewer-ask', text: 'cheap flights to Lisbon' });
      expect(onDraft.mock.calls).toEqual([['Search the web in the browser for: cheap flights to Lisbon']]);
      expect(onSend).not.toHaveBeenCalled();
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

    it("frames no viewer for another session than the pane's own", async () => {
      embedBrowser.mockResolvedValue({
        ...link(),
        session_id: 't-other',
        view_url: `${window.location.origin}/browser/sessions/t-other/view?et=tok`,
      });
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(embedBrowser).toHaveBeenCalledWith('t-abc');
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(screen.getByText("The browser isn't reachable")).toBeInTheDocument();
      expect(screen.getByText('The browser returned an unexpected address.')).toBeInTheDocument();
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
      /* The router's starting page while it reloads, or an edge error page:
         each loads the frame and never says it is ready. */
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
      // The person's retry starts the clock over.
      act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS - 1); });
      expect(screen.queryByText(/taking longer than usual/)).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();
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

    it('delegates no permission to the viewer, and sends it no referrer', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      const frame = screen.getByTitle('Shared browser');
      // No allow attribute: no clipboard or any other permission reaches the viewer.
      expect(frame).not.toHaveAttribute('allow');
      expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
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

  describe('the keyboard', () => {
    it('gives the keyboard to a viewer that says it is ready with a port', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      expect(document.activeElement).toBe(document.body);
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      expect(document.activeElement).toBe(screen.getByTitle('Shared browser'));
      expect(port.postMessage).toHaveBeenCalledWith({ type: 'browser-viewer-focus' });
    });

    it('takes no focus from a focused button outside the pane', async () => {
      render(<><button type="button">Elsewhere</button><BrowserPanel sessionId="t-abc" onClose={() => {}} /></>);
      await flush();
      const button = screen.getByRole('button', { name: 'Elsewhere' });
      button.focus();
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      expect(document.activeElement).toBe(button);
      expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('takes no focus for a ready with no port', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      expect(document.activeElement).toBe(document.body);
    });

    it('takes no focus from a field the person types in', async () => {
      render(<><textarea aria-label="Message" /><BrowserPanel sessionId="t-abc" onClose={() => {}} /></>);
      await flush();
      const field = screen.getByLabelText('Message');
      field.focus();
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      expect(document.activeElement).toBe(field);
      expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('takes no focus while the start page covers the viewer, and gives it once a page opens', async () => {
      render(<BrowserPanel sessionId="t-abc" startBlank agentLabel="Anton" onClose={() => {}} taskKey="t" onSend={vi.fn()} />);
      await flush();
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'about:blank' });
      await flush();
      expect(document.activeElement).toBe(document.body);
      expect(port.postMessage).not.toHaveBeenCalled();

      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://www.kayak.com/' });
      await flush();
      expect(document.activeElement).toBe(screen.getByTitle('Shared browser'));
      expect(port.postMessage.mock.calls).toEqual([[{ type: 'browser-viewer-focus' }]]);
    });

    it('keeps the port open while its frame stays, and closes it when the frame goes', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://www.kayak.com/' });
      await flush();
      expect(port.close).not.toHaveBeenCalled();

      // No browser slot is free: the pane stops and drops the frame.
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4503 });
      await flush();
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(port.close).toHaveBeenCalledTimes(1);
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

    /* The router's refusal pages post 4401, 4504, 4502 and 4500; the viewer
       posts its socket's own code. The pane re-mints on any of them. */
    it.each([4401, 4504, 4502, 4500, 4999, undefined])(
      'mints a new link when its own viewer reports a close (code %s), and ignores other windows',
      async (code) => {
        render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
        await flush();
        const win = frameWindow();
        messageFrom({ postMessage: vi.fn() }, { type: 'browser-viewer-closed', code });
        messageFrom(null, { type: 'browser-viewer-closed', code });
        await flush();
        expect(embedBrowser).toHaveBeenCalledTimes(1);

        embedBrowser.mockResolvedValue(link(2));
        act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
        messageFrom(win, { type: 'browser-viewer-closed', code });
        await flush();
        expect(embedBrowser).toHaveBeenCalledTimes(2);
        expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
      },
    );

    it("waits for the new frame's own ready after a re-mint", async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      expect(screen.queryByRole('status')).toBeNull();

      // The viewer's lease ends.
      embedBrowser.mockResolvedValue(link(2));
      act(() => { vi.advanceTimersByTime(15 * 60_000); });
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4401 });
      await flush();
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('stops after two slow refusals in a row before the viewer is ready', async () => {
      /* A refusal page that comes 10 s or more after its link, such as a 502
         after a hung pod check, is still a failed open. */
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      embedBrowser.mockResolvedValue(link(2));
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS + 1); });
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4502 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);

      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS + 1); });
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4502 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(screen.getByText("The browser isn't reachable")).toBeInTheDocument();
      expect(screen.getByText('The browser view keeps closing. Try again in a moment.')).toBeInTheDocument();
    });

    it('keeps the starting clock running across the new links a close brings', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      embedBrowser.mockResolvedValue(link(2));
      act(() => { vi.advanceTimersByTime(60_000); });
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4401 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS - 60_000); });
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();

      // The network coming back starts it over.
      embedBrowser.mockResolvedValue(link(3));
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS - 1); });
      expect(screen.queryByText(/taking longer than usual/)).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();
    });

    it("mints again, counting nothing, when the starting page's own link lapses", async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS); });
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();

      // The starting page posts 4401 as its ticket is about to run out.
      embedBrowser.mockResolvedValue(link(2));
      act(() => { vi.advanceTimersByTime(115_000 - STARTING_TIMEOUT_MS); });
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4401 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
      expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();

      // The lapse counted nothing: one quick refusal after it still re-mints.
      embedBrowser.mockResolvedValue(link(3));
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 4502 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(3);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}3`);

      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      expect(screen.queryByRole('status')).toBeNull();
    });

    it.each([
      [4503, 'No browser is free', 'Every browser is busy right now. Try again in a few minutes.'],
      [4429, 'Your browser is full', 'Your browser already has 4 tasks open.'],
    ])('says why on %s and mints nothing on its own, until the person, the tab or the network asks', async (code, title, line) => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(1);
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      // The browser is reachable, just full: the title says which.
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.queryByText("The browser isn't reachable")).toBeNull();
      expect(screen.getByText(line)).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toBeInTheDocument();

      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(embedBrowser).toHaveBeenCalledTimes(3);

      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code });
      await flush();
      setVisibility('hidden');
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(4);
      expect(screen.getByTitle('Shared browser')).toBeInTheDocument();
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
