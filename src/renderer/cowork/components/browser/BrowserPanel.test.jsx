import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const embedBrowser = vi.fn();
vi.mock('../../api', () => ({ embedBrowser: (...args) => embedBrowser(...args) }));

import { BrowserPanel, START_FADE_MS, STARTING_TIMEOUT_MS, isBlankPage, webPaneNote } from './BrowserPanel';
import { QUICK_CLOSE_MS, RELINK_RETRY_MS, RELINK_WAIT_MS } from '../../lib/browserSession';
import viewerMessages from '../../__fixtures__/browser-viewer/messages.json';
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

// Every message the pane posted to the frame's window that carries a ticket: none may.
function ticketsOnWindow() {
  return frameWindow().postMessage.mock.calls.filter(([message]) => message?.type === 'browser-viewer-ticket' || message?.ticket !== undefined);
}

/* The browser service's dropped connection, step by step: the viewer's
   ready with its port, live, closed 1006, the pane's ticket, live again. */
const DROP = viewerMessages.drop_sequence;
const [DROP_READY, DROP_LIVE, DROP_CLOSED, DROP_TICKET, DROP_LIVE_AGAIN] = DROP;

// One viewer step of the drop sequence, from this pane's own frame.
function fromViewer(step, port, fields = {}) {
  messageFrom(frameWindow(), { ...step.message, ...fields }, step.carries_port ? [port] : undefined);
}

// A viewer that took the keyboard and went live, with its port.
async function liveViewer() {
  render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
  await flush();
  const frame = screen.getByTitle('Shared browser');
  const port = fakePort();
  fromViewer(DROP_READY, port);
  fromViewer(DROP_LIVE, port);
  expect(document.activeElement).toBe(frame);
  return { frame, port };
}

// The pane's stop: an error or the slow-start offer, either one in place of the view.
function stopShown() {
  return document.querySelector('.browser-panel__empty');
}

// The embed request's error for an HTTP answer, as api.js's responseError builds it.
function embedRefused(status) {
  return Object.assign(new Error(`API /browse/embed returned ${status}`), { status });
}

function serviceUnavailable() {
  return embedRefused(503);
}

async function flush() {
  await act(async () => {});
}

describe('BrowserPanel', () => {
  // The frames point at a live host: keep happy-dom from loading them, so
  // the tests decide when a frame has loaded.
  let iframeLoading;
  // The back-off spreads each retry by Math.random(); 0 keeps each at its whole delay.
  let random;
  beforeEach(() => {
    vi.useFakeTimers();
    random = vi.spyOn(Math, 'random').mockReturnValue(0);
    embedBrowser.mockReset();
    embedBrowser.mockResolvedValue(link());
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
  });
  afterEach(() => {
    random.mockRestore();
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

  describe('the hint', () => {
    const AGENT_USING = 'Cowork is using it. Take over to use it yourself.';

    it("the web pane's hint names Take over and follows who holds the browser", async () => {
      render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={() => {}} />);
      await flush();
      expect(screen.getByText(AGENT_USING)).toBeInTheDocument();

      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://www.kayak.com/flights' });
      messageFrom(frameWindow(), { type: 'browser-viewer-control', holder: 'human', reason: 'sign in' });
      expect(screen.getByText('Your turn on www.kayak.com: sign in. Click Done to hand it back to Cowork.')).toBeInTheDocument();
      expect(screen.queryByText(/Click in it to take over/)).toBeNull();

      messageFrom(frameWindow(), { type: 'browser-viewer-control', holder: 'agent' });
      expect(screen.getByText(AGENT_USING)).toBeInTheDocument();
    });

    it('starts another session with the agent holding the browser', async () => {
      const { rerender } = render(<BrowserPanel sessionId="t-abc" agentLabel="Cowork" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-control', holder: 'human', reason: '' });
      expect(screen.getByText('Your turn on a new tab. Click Done to hand it back to Cowork.')).toBeInTheDocument();

      embedBrowser.mockResolvedValue({ ...link(), session_id: 't-def', view_url: `${window.location.origin}/browser/sessions/t-def/view?et=tok` });
      rerender(<BrowserPanel sessionId="t-def" agentLabel="Cowork" onClose={() => {}} />);
      await flush();
      expect(embedBrowser).toHaveBeenLastCalledWith('t-def');
      expect(screen.getByText(AGENT_USING)).toBeInTheDocument();
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

    it("leaves the keyboard in the start page's field while the person types in it, and gives it once they sent it", async () => {
      const onSend = vi.fn();
      render(<BrowserPanel sessionId="t-abc" startBlank agentLabel="Anton" onClose={() => {}} taskKey="t" onSend={onSend} />);
      await flush();
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'about:blank' });
      await flush();
      const field = screen.getByLabelText('What to look up');
      field.focus();
      fireEvent.change(field, { target: { value: 'half typed' } });

      // A page opens while they type: the rest of their keys stay in the field.
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://other.example/form' });
      await flush();
      expect(document.activeElement).toBe(field);
      expect(port.postMessage).not.toHaveBeenCalled();

      // Back to a blank tab, then they send: the field turns off, and the next page gets the keyboard.
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'about:blank' });
      await act(async () => { vi.advanceTimersByTime(START_FADE_MS); });
      const again = screen.getByLabelText('What to look up');
      again.focus();
      fireEvent.change(again, { target: { value: 'flights to Lisbon' } });
      fireEvent.submit(again.closest('form'));
      expect(onSend).toHaveBeenCalledTimes(1);
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://www.kayak.com/' });
      await flush();
      expect(document.activeElement).toBe(screen.getByTitle('Shared browser'));
      expect(port.postMessage.mock.calls).toEqual([[{ type: 'browser-viewer-focus' }]]);
    });

    it('takes no keyboard while the tab is hidden', async () => {
      render(<BrowserPanel sessionId="t-abc" startBlank agentLabel="Anton" onClose={() => {}} taskKey="t" onSend={vi.fn()} />);
      await flush();
      const port = fakePort();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' }, [port]);
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'about:blank' });
      await flush();
      setVisibility('hidden');
      // The viewer posted this before the pause reached it.
      messageFrom(frameWindow(), { type: 'browser-viewer-url', url: 'https://other.example/form' });
      await flush();
      expect(document.activeElement).toBe(document.body);
      expect(port.postMessage.mock.calls).toEqual([[{ type: 'browser-viewer-pause' }]]);
    });

    it('takes a port only from the first ready in a frame, so a later document in it draws no ticket and its close reloads the frame', async () => {
      const { frame, port } = await liveViewer();
      fireEvent.load(frame);
      const later = fakePort();
      fromViewer(DROP_READY, later);
      // The first document's port goes with it, and the later one is refused.
      expect(port.close).toHaveBeenCalledTimes(1);
      expect(later.close).toHaveBeenCalledTimes(1);
      fromViewer(DROP_LIVE, later);

      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, later);
      await flush();
      const tickets = (p) => p.postMessage.mock.calls.filter(([m]) => m?.type === 'browser-viewer-ticket');
      expect(tickets(later)).toEqual([]);
      expect(tickets(port)).toEqual([]);
      expect(screen.getByTitle('Shared browser')).not.toBe(frame);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
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
    it('never mints on a timer for a frame whose page gave no port', async () => {
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

  describe('a dropped connection', () => {
    it("follows the browser service's drop sequence", () => {
      expect(DROP.map((step) => [step.from, step.message.type])).toEqual([
        ['viewer', 'browser-viewer-ready'],
        ['viewer', 'browser-viewer-live'],
        ['viewer', 'browser-viewer-closed'],
        ['pane', 'browser-viewer-ticket'],
        ['viewer', 'browser-viewer-live'],
      ]);
      expect(DROP_READY.carries_port).toBe(viewerMessages.ready_carries_port);
    });

    it('keeps its frame and the keyboard through a dropped connection, and hands the viewer a fresh ticket in place', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ ...DROP_TICKET.message, ticket: 'tok2' });
      fromViewer(DROP_LIVE_AGAIN, port);
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      expect(frame).toHaveAttribute('src', `${VIEW}1`);
      expect(document.activeElement).toBe(frame);
      expect(screen.queryByRole('status')).toBeNull();
      expect(ticketsOnWindow()).toEqual([]);
    });

    it('keeps the frame through a network drop and relinks when the network comes back', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockRejectedValue(new TypeError('Failed to fetch'));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(stopShown()).toBeNull();
      expect(screen.getByTitle('Shared browser')).toBe(frame);

      embedBrowser.mockResolvedValue(link(2));
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      expect(frame).toHaveAttribute('src', `${VIEW}1`);
      expect(stopShown()).toBeNull();
    });

    it('relinks after a router restart whose link fetch fails once', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockRejectedValueOnce(serviceUnavailable()).mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port, { code: 4401 });
      await flush();
      expect(stopShown()).toBeNull();
      expect(embedBrowser).toHaveBeenCalledTimes(2);

      await act(async () => { vi.advanceTimersByTime(RELINK_RETRY_MS); });
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      expect(stopShown()).toBeNull();
      expect(embedBrowser).toHaveBeenCalledTimes(3);
    });

    it('spreads each retry over the later half of its back-off, so panes that one router restart closed fetch apart', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      random.mockReturnValue(0.5);
      embedBrowser.mockRejectedValueOnce(serviceUnavailable()).mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port, { code: 4401 });
      await flush();
      await act(async () => { vi.advanceTimersByTime(RELINK_RETRY_MS * 0.75 - 1); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(embedBrowser).toHaveBeenCalledTimes(3);
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
    });

    it('retries a failed link after a close for a frame whose page gave no port', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      act(() => { vi.advanceTimersByTime(15_000); });
      embedBrowser.mockRejectedValueOnce(serviceUnavailable()).mockResolvedValue(link(3));
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 1000 });
      await flush();
      expect(stopShown()).toBeNull();

      await act(async () => { vi.advanceTimersByTime(RELINK_RETRY_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(3);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}3`);
      expect(stopShown()).toBeNull();
    });

    it('gives the frame a fresh link and the keyboard back when a ticket handed in place never goes live', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });

      // The new stream never says hello: the viewer has no socket left.
      embedBrowser.mockResolvedValue(link(3));
      fromViewer(DROP_CLOSED, port);
      await flush();
      const fresh = screen.getByTitle('Shared browser');
      expect(fresh).not.toBe(frame);
      expect(fresh).toHaveAttribute('src', `${VIEW}3`);
      expect(port.close).toHaveBeenCalledTimes(1);

      const freshPort = fakePort();
      fromViewer(DROP_READY, freshPort);
      expect(document.activeElement).toBe(fresh);
      expect(freshPort.postMessage).toHaveBeenCalledWith({ type: 'browser-viewer-focus' });
    });

    it('gives the frame a fresh link when a ticket handed in place neither goes live nor closes in time', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });

      embedBrowser.mockResolvedValue(link(3));
      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS - 1); });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(screen.getByTitle('Shared browser')).not.toBe(frame);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}3`);
      expect(embedBrowser).toHaveBeenCalledTimes(3);
    });

    it('gives a frame it reloaded after a close the whole wait for its own live', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();

      // The ticket handed in place fails late, and the frame reloads.
      act(() => { vi.advanceTimersByTime(100_000); });
      embedBrowser.mockResolvedValue(link(3));
      fromViewer(DROP_CLOSED, port);
      await flush();
      const fresh = screen.getByTitle('Shared browser');
      expect(fresh).not.toBe(frame);
      fromViewer(DROP_READY, fakePort());

      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS - 1); });
      expect(screen.getByTitle('Shared browser')).toBe(fresh);
      expect(embedBrowser).toHaveBeenCalledTimes(3);
    });

    it("gives the reload's link the whole wait from the latest close when a ticket handed in place fails late", async () => {
      const { port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });

      // The ticket fails late, and the reload's link fails for a while.
      act(() => { vi.advanceTimersByTime(110_000); });
      const blip = new TypeError('Failed to fetch');
      embedBrowser.mockRejectedValueOnce(blip).mockRejectedValueOnce(blip).mockRejectedValueOnce(blip).mockRejectedValueOnce(blip)
        .mockResolvedValue(link(3));
      fromViewer(DROP_CLOSED, port);
      await flush();
      // Retries 2, 4 and 8 s apart all fail, past RELINK_WAIT_MS after the first close.
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(6);
      expect(stopShown()).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}3`);
      expect(stopShown()).toBeNull();
    });

    it('reloads the frame, then says why, when the link still fails RELINK_WAIT_MS after the close', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockRejectedValue(new TypeError('Failed to fetch'));
      fromViewer(DROP_CLOSED, port);
      await flush();
      // Each retry's failure schedules the next, so the clock runs one timer at a time.
      await act(async () => { await vi.advanceTimersByTimeAsync(RELINK_WAIT_MS - 1); });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      expect(stopShown()).toBeNull();
      // 2, 4, 8, 16 and 30 s apart, then every 30 s.
      expect(embedBrowser).toHaveBeenCalledTimes(8);

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(screen.getByText("The browser isn't reachable")).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    });

    it('reloads the frame when the network comes back after the wait and the ticket still fails', async () => {
      const { port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockRejectedValue(new TypeError('Failed to fetch'));
      fromViewer(DROP_CLOSED, port);
      await flush();
      // The wait runs out with no link, and then the reload's fetch succeeds.
      await act(async () => { await vi.advanceTimersByTimeAsync(RELINK_WAIT_MS - 1); });
      embedBrowser.mockResolvedValueOnce(link(3));
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      const reloaded = screen.getByTitle('Shared browser');
      expect(reloaded).toHaveAttribute('src', `${VIEW}3`);
      fromViewer(DROP_READY, fakePort());

      // Its viewer isn't live yet: a ticket fetched now that fails reloads the frame again.
      embedBrowser.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(link(4));
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}4`);
      expect(screen.getByTitle('Shared browser')).not.toBe(reloaded);
    });

    it.each([401, 403])('says why at once when the link after a close is refused (%s), for a viewer with a port', async (status) => {
      const { port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockRejectedValue(embedRefused(status));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.queryByTitle('Shared browser')).toBeNull();
      expect(screen.getByText("The browser isn't reachable")).toBeInTheDocument();
      expect(screen.getByText(`API /browse/embed returned ${status}`)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(RELINK_WAIT_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
    });

    it.each([401, 403])('says why at once when the link after a close is refused (%s), for a frame whose page gave no port', async (status) => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      act(() => { vi.advanceTimersByTime(15_000); });
      embedBrowser.mockRejectedValue(embedRefused(status));
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 1000 });
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Starting your browser…')).toBeNull();
      expect(screen.getByText(`API /browse/embed returned ${status}`)).toBeInTheDocument();
    });

    it('says why at once when the link is refused as the tab shows again', async () => {
      await liveViewer();
      setVisibility('hidden');
      await act(async () => { vi.advanceTimersByTime(60 * 60_000); });
      embedBrowser.mockRejectedValue(embedRefused(401));
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByText('API /browse/embed returned 401')).toBeInTheDocument();
    });

    it.each([408, 424, 429, 502])('tries a link that failed with %s again on the back-off', async (status) => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockRejectedValueOnce(embedRefused(status)).mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(stopShown()).toBeNull();
      await act(async () => { vi.advanceTimersByTime(RELINK_RETRY_MS); });
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
    });

    it("takes no port, keyboard or link from another window's ready, live and close", async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      frameWindow();
      const stranger = { postMessage: vi.fn() };
      const port = fakePort();
      messageFrom(stranger, { type: 'browser-viewer-ready' }, [port]);
      messageFrom(stranger, { type: 'browser-viewer-live' });
      expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      messageFrom(stranger, { type: 'browser-viewer-closed', code: 1006 });
      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS); });
      expect(document.activeElement).toBe(document.body);
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it('stops after a second failed open for a viewer with a port that never goes live', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      fromViewer(DROP_READY, fakePort());
      act(() => { vi.advanceTimersByTime(15_000); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, null);
      await flush();
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);

      fromViewer(DROP_READY, fakePort());
      act(() => { vi.advanceTimersByTime(15_000); });
      fromViewer(DROP_CLOSED, null);
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(screen.getByText('The browser view keeps closing. Try again in a moment.')).toBeInTheDocument();
    });

    it("waits for the viewer's own close after the frame the watchdog reloaded, and counts that close as a failed open", async () => {
      const { port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      embedBrowser.mockResolvedValue(link(3));
      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS); });
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}3`);

      // Its viewer says ready and neither goes live nor closes: no second watchdog fetches.
      fromViewer(DROP_READY, fakePort());
      await act(async () => { vi.advanceTimersByTime(10 * RELINK_WAIT_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(3);

      // The router ends a stream that never starts, and the viewer says so: a failed open.
      embedBrowser.mockResolvedValue(link(4));
      fromViewer(DROP_CLOSED, null);
      await flush();
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}4`);
      fromViewer(DROP_READY, fakePort());
      act(() => { vi.advanceTimersByTime(15_000); });
      fromViewer(DROP_CLOSED, null);
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(4);
      expect(screen.getByText('The browser view keeps closing. Try again in a moment.')).toBeInTheDocument();
    });

    it('fetches nothing on online for a viewer with a port that is ready and not yet live', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      fromViewer(DROP_READY, fakePort());
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it('ends the reconnect once the frame a close reloaded is ready with no port, so a later failed link shows at once', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });
      act(() => { vi.advanceTimersByTime(15_000); });
      embedBrowser.mockResolvedValue(link(2));
      messageFrom(frameWindow(), { type: 'browser-viewer-closed', code: 1000 });
      await flush();
      messageFrom(frameWindow(), { type: 'browser-viewer-ready' });

      embedBrowser.mockRejectedValue(new TypeError('Failed to fetch'));
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    });

    it('mints nothing on online while its viewer is live', async () => {
      const { frame } = await liveViewer();
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
      expect(screen.getByTitle('Shared browser')).toBe(frame);
    });
  });

  describe('the lease and a hidden tab', () => {
    // link() leaves 780 s between the ticket's redeem-by time and the lease's end.
    const RENEW_AFTER_MS = 780_000;

    it('hands the open viewer a fresh ticket one ticket-life before its lease ends, and only while the tab is visible', async () => {
      const { frame, port } = await liveViewer();
      embedBrowser.mockResolvedValue(link(2));
      await act(async () => { vi.advanceTimersByTime(RENEW_AFTER_MS - 1); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      fromViewer(DROP_LIVE, port);

      setVisibility('hidden');
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-pause' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      await act(async () => { vi.advanceTimersByTime(2 * 60 * 60_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);

      embedBrowser.mockResolvedValue(link(3));
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(3);
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok3' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      expect(frame).toHaveAttribute('src', `${VIEW}1`);
      expect(document.activeElement).toBe(frame);
      expect(ticketsOnWindow()).toEqual([]);

      // That ticket never goes live: the frame reloads with a fresh link once the wait runs out.
      embedBrowser.mockResolvedValue(link(4));
      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS - 1); });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(screen.getByTitle('Shared browser')).not.toBe(frame);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}4`);
    });

    it('gives no renewal to a viewer with a port that never went live', async () => {
      render(<BrowserPanel sessionId="t-abc" onClose={() => {}} />);
      await flush();
      fromViewer(DROP_READY, fakePort());
      await act(async () => { vi.advanceTimersByTime(RENEW_AFTER_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it('gives a frame reloaded from a live viewer no renewal until its own viewer goes live', async () => {
      await liveViewer();
      embedBrowser.mockResolvedValue(link(2));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload browser view' })); });
      const port = fakePort();
      fromViewer(DROP_READY, port);
      await act(async () => { vi.advanceTimersByTime(RENEW_AFTER_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-viewer-ticket' }));
    });

    it('gives a link with no lease no renewal', async () => {
      const { lease_expires_at: _lease, ...noLease } = link();
      embedBrowser.mockResolvedValue(noLease);
      await liveViewer();
      await act(async () => { vi.advanceTimersByTime(2 * 60 * 60_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
    });

    it('starts the count of failed opens over when the tab shows again', async () => {
      const { port } = await liveViewer();
      // A quick drop counts one failed open.
      act(() => { vi.advanceTimersByTime(5_000); });
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port);
      await flush();
      setVisibility('hidden');
      embedBrowser.mockResolvedValue(link(3));
      setVisibility('visible');
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok3' });

      // That ticket fails: one failed open since the tab showed, so the frame reloads.
      act(() => { vi.advanceTimersByTime(15_000); });
      embedBrowser.mockResolvedValue(link(4));
      fromViewer(DROP_CLOSED, port);
      await flush();
      expect(stopShown()).toBeNull();
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}4`);
    });

    it('a connection that drops within 10 s of a renewal relinks and counts nothing', async () => {
      const { frame, port } = await liveViewer();
      // Twice: a close rule that timed from the renewal would stop on the second.
      for (const n of [2, 4]) {
        embedBrowser.mockResolvedValue(link(n));
        await act(async () => { vi.advanceTimersByTime(RENEW_AFTER_MS); });
        expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: `tok${n}` });
        fromViewer(DROP_LIVE, port);

        act(() => { vi.advanceTimersByTime(5_000); });
        embedBrowser.mockResolvedValue(link(n + 1));
        fromViewer(DROP_CLOSED, port);
        await flush();
        expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: `tok${n + 1}` });
        fromViewer(DROP_LIVE_AGAIN, port);
        expect(stopShown()).toBeNull();
        expect(screen.getByTitle('Shared browser')).toBe(frame);
      }
      expect(embedBrowser).toHaveBeenCalledTimes(5);
    });

    it('does nothing when a renewal fails, and the lease close then relinks', async () => {
      const { frame, port } = await liveViewer();
      embedBrowser.mockRejectedValue(new TypeError('Failed to fetch'));
      await act(async () => { vi.advanceTimersByTime(RENEW_AFTER_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(port.postMessage).toHaveBeenCalledTimes(1);
      expect(screen.getByTitle('Shared browser')).toBe(frame);
      expect(stopShown()).toBeNull();

      // The live socket runs on to its lease, and the router closes it.
      await act(async () => { vi.advanceTimersByTime(120_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      embedBrowser.mockResolvedValue(link(2));
      fromViewer(DROP_CLOSED, port, { code: 4401 });
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
    });

    it('leaves a viewer it paused alone while the tab is hidden, even when a close crosses the pause', async () => {
      const { frame, port } = await liveViewer();
      act(() => { vi.advanceTimersByTime(QUICK_CLOSE_MS); });
      setVisibility('hidden');
      // The viewer posted this before the pause reached it.
      fromViewer(DROP_CLOSED, port);
      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);
      expect(screen.getByTitle('Shared browser')).toBe(frame);

      embedBrowser.mockResolvedValue(link(2));
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
    });

    it('renews nothing for a live that crosses the pause, and reloads the frame when the ticket it hands as the tab shows never goes live', async () => {
      const { frame, port } = await liveViewer();
      setVisibility('hidden');
      // The viewer posted this before the pause reached it.
      fromViewer(DROP_LIVE, port);
      await act(async () => { vi.advanceTimersByTime(2 * 60 * 60_000); });
      expect(embedBrowser).toHaveBeenCalledTimes(1);

      embedBrowser.mockResolvedValue(link(2));
      setVisibility('visible');
      await flush();
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok2' });
      embedBrowser.mockResolvedValue(link(3));
      await act(async () => { vi.advanceTimersByTime(RELINK_WAIT_MS); });
      expect(screen.getByTitle('Shared browser')).not.toBe(frame);
      expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}3`);
    });

    it('relinks when the network comes back after the fetch as the tab shows failed, even after a live that crossed the pause', async () => {
      const { frame, port } = await liveViewer();
      setVisibility('hidden');
      fromViewer(DROP_LIVE, port);
      embedBrowser.mockRejectedValue(new TypeError('Failed to fetch'));
      setVisibility('visible');
      await flush();
      expect(embedBrowser).toHaveBeenCalledTimes(2);

      embedBrowser.mockResolvedValue(link(3));
      await act(async () => { window.dispatchEvent(new Event('online')); });
      expect(embedBrowser).toHaveBeenCalledTimes(3);
      expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'browser-viewer-ticket', ticket: 'tok3' });
      expect(screen.getByTitle('Shared browser')).toBe(frame);
    });
  });
});
