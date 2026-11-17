import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const shell = vi.hoisted(() => ({ isWeb: true, inApp: false, shown: [], hides: 0, bounds: [] }));
vi.mock('../../platform/host', () => ({
  host: {
    get isWeb() { return shell.isWeb; },
    get isElectron() { return !shell.isWeb; },
    get supportsInAppBrowser() { return shell.inApp; },
    inAppBrowser: {
      show: async (sessionId) => {
        shell.shown.push(sessionId);
        return { exists: true, drawn: true };
      },
      hide: async () => { shell.hides += 1; },
      setBounds: async (bounds) => {
        shell.bounds.push(bounds);
        return { drawn: true };
      },
      onState: () => () => {},
    },
    isMac: () => false,
    isLocalApiOrigin: () => true,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  openExternal: vi.fn(),
  getAccessToken: vi.fn(async () => null),
  get isElectron() { return !shell.isWeb; },
  get isWeb() { return shell.isWeb; },
}));

const embedBrowser = vi.fn();
const submitAnswer = vi.hoisted(() => vi.fn(async () => ({ status: 'accepted' })));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitAnswer: (...args) => submitAnswer(...args),
  provisionBrowser: vi.fn(async () => ({ status: 'starting' })),
  embedBrowser: (...args) => embedBrowser(...args),
  openBrowserAt: (...args) => openBrowserAt(...args),
}));
const openBrowserAt = vi.fn();

import ChatView, { BROWSER_DONE_MESSAGE } from './ChatView';
import { browserStep } from '../lib/browserSession';
import { NOWHERE } from '../components/browser/LocalBrowserStage';
import { resetBrowserPrefsForTests, syncBrowserPrefs } from '../lib/browserPrefs';
import { BROWSER_ACTION_BADGE } from '../lib/browserSteps';
import { handBackBrowser, handedBack, resetHandBack } from '../lib/browserHandBack';

const VIEW = `${window.location.origin}/browser/sessions/t-abc/view?et=tok`;
const step = (sessionId = 't-abc') => browserStep({ session_id: sessionId }, 1);

const pastTurn = [
  { id: 'u1', role: 'user', content: 'Check the site' },
  { id: 'a1', role: 'assistant', content: 'Done.', steps: [step()] },
];
const liveTurn = (sessionId = 't-abc') => ({
  role: '_streaming',
  content: '',
  steps: [step(sessionId)],
  currentThought: null,
  streamStatus: 'in_progress',
});
const task = (id, messages) => ({ id, title: `Task ${id}`, status: 'active', messages });

function pane() {
  return screen.queryByRole('complementary', { name: 'Browser mode' });
}

/* The transcript folds a turn's steps: unfold them if needed, then click the
   Browser step. */
async function clickBrowserStep() {
  if (!screen.queryAllByText('Opened the browser').length) {
    const toggle = screen.getAllByRole('button', { expanded: false }).find((b) => b.closest('.answer-turn'));
    await act(async () => { fireEvent.click(toggle); });
  }
  await act(async () => { fireEvent.click(screen.getAllByText('Opened the browser')[0]); });
}

function setWidth(px) {
  window.happyDOM.setViewport({ width: px });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

/* happy-dom does no layout: give the desktop stage a box, so the native view
   has somewhere to show. */
function stageHasArea() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function box() {
    return this.classList?.contains('browser-panel__stage')
      ? { left: 600, top: 56, x: 600, y: 56, width: 600, height: 700 }
      : { left: 0, top: 0, x: 0, y: 0, width: 0, height: 0 };
  });
}

/* A ResizeObserver that reports every element `width` wide at once, as the
   chat's root measures at a 1200 px window with the sidebar docked. */
function observeWidth(width) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb([{ contentRect: { width } }]); }
    disconnect() {}
  });
}

describe('ChatView shared browser pane', () => {
  let iframeLoading;
  beforeEach(() => {
    shell.isWeb = true;
    shell.inApp = false;
    shell.shown = [];
    shell.hides = 0;
    shell.bounds = [];
    embedBrowser.mockReset();
    openBrowserAt.mockReset();
    embedBrowser.mockResolvedValue({ session_id: 't-abc', view_url: VIEW, ticket_expires_at: 1_900_000_000, lease_expires_at: 1_900_000_780 });
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
    setWidth(1400);
    // These show the browser whenever the agent browses: Only show the browser when I'm needed off.
    syncBrowserPrefs({ browserOnlyWhenNeeded: false });
  });
  afterEach(() => {
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
    setWidth(1024);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetBrowserPrefsForTests();
  });

  it('never opens for a past Browser step while the browser is off, and mints nothing', async () => {
    render(<ChatView task={task('p-off', pastTurn)} onSend={vi.fn()} />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it('opens from the top-right Show browser icon, which steps aside while the pane is open', async () => {
    render(<ChatView task={task('p-icon', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show browser' })); });
    expect(pane()).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Show browser' })).toBeNull();
  });

  /* The viewer says who holds the browser, from the pane's own frame. */
  const control = (holder) => act(async () => {
    const frame = pane().querySelector('iframe');
    if (!frame.__testWindow) {
      const win = { postMessage: vi.fn() };
      Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win });
      frame.__testWindow = win;
    }
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'browser-viewer-control', holder, reason: 'sign in' }, source: frame.__testWindow }));
  });

  it('Done after a turn that ended waiting on the person carries the task on', async () => {
    const onSend = vi.fn();
    const { rerender } = render(<ChatView task={task('p-done', [pastTurn[0], liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('human');
    rerender(<ChatView task={task('p-done', pastTurn)} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('agent');
    expect(onSend).toHaveBeenCalledWith(BROWSER_DONE_MESSAGE);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Done during the turn, or with no turn waiting, sends nothing: a running turn sees it itself', async () => {
    const onSend = vi.fn();
    render(<ChatView task={task('p-run', [pastTurn[0], liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('human');
    await control('agent');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Done after a turn the person stopped sends nothing: the turn stays stopped', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { container, rerender } = render(
      <ChatView task={task('p-stop', [pastTurn[0], liveTurn()])} onSend={onSend} onStop={onStop} browserOn />,
    );
    await act(async () => {});
    await control('human');
    await act(async () => { fireEvent.click(container.querySelector('.send-btn.stop')); });
    expect(onStop).toHaveBeenCalled();
    rerender(<ChatView task={task('p-stop', pastTurn)} onSend={onSend} onStop={onStop} browserOn />);
    await act(async () => {});
    await control('agent');
    expect(onSend).not.toHaveBeenCalled();
  });

  /* The card's Stop ends the turn only once anton reads it, so the turn
     streams on a moment: it must not count as held through, or the watch's
     hand-back after it would carry the stopped task on. */
  it("Done after the hand-over card's Stop sends nothing, though the turn streamed on after it", async () => {
    const onSend = vi.fn();
    const handOver = {
      id: 'question-browser:h1',
      badge: 'AskUser',
      status: 'in_progress',
      data: {
        question_id: 'browser:0123456789abcdef',
        prompt: "Your turn on www.united.com: Sign in to United\n\nUse the browser beside the chat. I'll carry on by myself once that's done, or click Done in the browser.",
        options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
        answer: null,
      },
    };
    const live = (extra = []) => ({ ...liveTurn(), steps: [...liveTurn().steps, handOver, ...extra] });
    const { rerender } = render(<ChatView task={task('p-card-stop', [pastTurn[0], live()])} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('human');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'More actions' })); });
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' })); });
    expect(submitAnswer).toHaveBeenCalledWith('p-card-stop', 'browser:0123456789abcdef', { values: ['stop'] });
    // The turn streams on until anton reads the Stop.
    rerender(<ChatView task={task('p-card-stop', [pastTurn[0], live([step('t-abc')])])} onSend={onSend} browserOn />);
    await act(async () => {});
    rerender(<ChatView task={task('p-card-stop', pastTurn)} onSend={onSend} browserOn />);
    await act(async () => {});
    // The watch hands the browser back as the person's Done.
    await control('agent');
    expect(onSend).not.toHaveBeenCalled();
  });

  /* A card left for later, with the browser off for the task: no pane can
     show that browser, so the card's Done, continue can't reach its viewer.
     The wait ends there, and the task isn't carried on with the browser
     maybe still the person's. */
  it("says the browser didn't open when no pane can show it for the card's Done, continue", async () => {
    resetHandBack();
    const onSend = vi.fn();
    const leftForLater = {
      id: 'question-browser:h2',
      badge: 'AskUser',
      status: 'completed',
      data: {
        question_id: 'browser:fedcba9876543210',
        prompt: "Your turn on www.united.com: Sign in to United\n\nUse the browser beside the chat, and click Done in the browser when you're finished.",
        options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
        answer: { status: 'answered', values: ['later'], text: '' },
      },
    };
    const turn = [pastTurn[0], { ...pastTurn[1], steps: [step(), leftForLater] }];
    render(<ChatView task={task('p-unviewable', turn)} onSend={onSend} />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done, continue' })); });
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent("The browser didn't open. Open it and try Done, continue again.");
    expect(screen.getByRole('button', { name: 'Done, continue' })).not.toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
    expect(pane()).toBeNull();
    // Nothing is left waiting for a viewer of that browser.
    await expect(handedBack('t-abc')).resolves.toBe('sent');
  });

  /* The card's Done, continue opens the pane and waits for its viewer. The
     person switches task before it comes, so the card and the pane go. A
     later hand-over in that task must not get that old Done when its viewer
     says the person holds the browser. */
  it("ends the card's waiting hand-back when the card goes, so a later hand-over's viewer gets no Done", async () => {
    resetHandBack();
    const onSend = vi.fn();
    const leftForLater = {
      id: 'question-browser:h3',
      badge: 'AskUser',
      status: 'completed',
      data: {
        question_id: 'browser:00112233445566ff',
        prompt: "Your turn on www.united.com: Sign in to United\n\nUse the browser beside the chat, and click Done in the browser when you're finished.",
        options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
        answer: { status: 'answered', values: ['later'], text: '' },
      },
    };
    const turn = [pastTurn[0], { ...pastTurn[1], steps: [step(), leftForLater] }];
    const { rerender } = render(<ChatView task={task('p-gone', turn)} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done, continue' })); });
    await act(async () => {});
    // The pane opens for the hand-back, and is still starting its browser.
    expect(pane()).not.toBeNull();
    rerender(<ChatView task={task('p-elsewhere', [{ id: 'u9', role: 'user', content: 'Hi' }])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done, continue' })).toBeNull();
    // Back in the task, Anton hands the browser over again.
    rerender(<ChatView task={task('p-gone', [...turn, { id: 'u2', role: 'user', content: 'Book it' }, liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('human');
    const win = pane().querySelector('iframe').__testWindow;
    expect(win.postMessage).not.toHaveBeenCalledWith({ type: 'browser-hand-back' }, '*');
    expect(onSend).not.toHaveBeenCalled();
    resetHandBack();
  });

  /* A voice call's browser_done waits for the viewer with no card to own the
     wait. The pane leaving that browser before the viewer comes ends it, so
     a later hand-over in the task never gets that old Done. */
  it('ends a hand-back with no card waiting on it when the task changes, so a later hand-over gets no Done', async () => {
    resetHandBack();
    const onSend = vi.fn();
    const { rerender } = render(<ChatView task={task('p-voice', [pastTurn[0], liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(await handBackBrowser('t-abc', { desktop: false })).toBe('waiting');
    let end = null;
    void handedBack('t-abc').then((value) => { end = value; });
    rerender(<ChatView task={task('p-other', [{ id: 'u9', role: 'user', content: 'Hi' }])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(end).toBe('unreachable');
    // Back in the task, Anton hands the browser over again.
    rerender(<ChatView task={task('p-voice', [pastTurn[0], liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('human');
    expect(pane().querySelector('iframe').__testWindow.postMessage).not.toHaveBeenCalledWith({ type: 'browser-hand-back' }, '*');
    expect(onSend).not.toHaveBeenCalled();
    resetHandBack();
  });

  /* A voice call's browser_done waits for the pane's viewer, still starting.
     The hand-over is answered another way (the watch handed the browser
     back, or Done on the phone), and Anton hands over again in the same
     turn: the viewer saying the person holds the browser for that one must
     not get the old Done. */
  it("ends a waiting Done once its hand-over is answered another way, so the next hand-over gets none", async () => {
    resetHandBack();
    const onSend = vi.fn();
    const handOver = (questionId, answer = null) => ({
      id: `question-${questionId}`,
      badge: 'AskUser',
      status: answer ? 'completed' : 'in_progress',
      data: {
        question_id: questionId,
        prompt: "Your turn on www.united.com: Sign in to United\n\nUse the browser beside the chat. I'll carry on by myself once that's done, or click Done in the browser.",
        options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
        answer,
      },
    });
    const done = { status: 'answered', values: ['done'], text: '' };
    const live = (...cards) => ({ ...liveTurn(), steps: [...liveTurn().steps, ...cards] });
    const { rerender } = render(<ChatView task={task('p-next', [pastTurn[0], live(handOver('browser:aaaa1111'))])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(await handBackBrowser('t-abc', { desktop: false })).toBe('waiting');
    let end = null;
    void handedBack('t-abc').then((value) => { end = value; });
    rerender(<ChatView task={task('p-next', [pastTurn[0], live(handOver('browser:aaaa1111', done))])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(end).toBe('unreachable');
    rerender(<ChatView task={task('p-next', [pastTurn[0], live(handOver('browser:aaaa1111', done), handOver('browser:bbbb2222'))])} onSend={onSend} browserOn />);
    await act(async () => {});
    await control('human');
    expect(pane().querySelector('iframe').__testWindow.postMessage).not.toHaveBeenCalledWith({ type: 'browser-hand-back' }, '*');
    expect(onSend).not.toHaveBeenCalled();
    resetHandBack();
  });

  /* A Done asked for after the turn ended still waits for the viewer when
     the person sends a new message. The new turn's hand-over must not get
     it. A turn that ends with its hand-over open leaves the wait alone. */
  it('ends a waiting Done when the task starts a new turn, and not when a turn ends', async () => {
    resetHandBack();
    const onSend = vi.fn();
    const { rerender } = render(<ChatView task={task('p-turn', [pastTurn[0], liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(await handBackBrowser('t-abc', { desktop: false })).toBe('waiting');
    let end = null;
    void handedBack('t-abc').then((value) => { end = value; });
    rerender(<ChatView task={task('p-turn', pastTurn)} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(end).toBeNull();
    rerender(<ChatView task={task('p-turn', [...pastTurn, { id: 'u2', role: 'user', content: 'Book it' }, liveTurn()])} onSend={onSend} browserOn />);
    await act(async () => {});
    expect(end).toBe('unreachable');
    await control('human');
    expect(pane().querySelector('iframe').__testWindow.postMessage).not.toHaveBeenCalledWith({ type: 'browser-hand-back' }, '*');
    resetHandBack();
  });

  /* The pane stopped before the person clicked the card's Done, continue:
     the click asks it again, as Try again does, so the card hears whether a
     viewer came rather than waiting on a pane that gave up. */
  it("asks a pane that already stopped again for the card's Done, continue", async () => {
    resetHandBack();
    const handOver = {
      id: 'question-browser:h4',
      badge: 'AskUser',
      status: 'in_progress',
      data: {
        question_id: 'browser:0011223344556677',
        prompt: "Your turn on www.united.com: Sign in to United\n\nUse the browser beside the chat, and click Done in the browser when you're finished.",
        options: [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
        answer: null,
      },
    };
    const live = { ...liveTurn(), steps: [...liveTurn().steps, handOver] };
    render(<ChatView task={task('p-stalled', [pastTurn[0], live])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    await control('human');
    // No browser slot: the pane stops asking for a viewer.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'browser-viewer-closed', code: 4503 }, source: pane().querySelector('iframe').__testWindow,
      }));
    });
    expect(within(pane()).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(embedBrowser).toHaveBeenCalledTimes(1);
    embedBrowser.mockRejectedValue(new Error('No such browser.'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done, continue' })); });
    await act(async () => {});
    expect(embedBrowser).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent("The browser didn't open. Open it and try Done, continue again.");
    expect(screen.getByRole('button', { name: 'Done, continue' })).not.toBeDisabled();
    resetHandBack();
  });

  it('ends a waiting hand-back when the person closes the pane', async () => {
    resetHandBack();
    render(<ChatView task={task('p-close', [pastTurn[0], liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(await handBackBrowser('t-abc', { desktop: false })).toBe('waiting');
    let end = null;
    void handedBack('t-abc').then((value) => { end = value; });
    await act(async () => { fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' })); });
    expect(pane()).toBeNull();
    expect(end).toBe('unreachable');
    resetHandBack();
  });

  it("opens the task's real browser on a blank tab from the Show browser icon", async () => {
    openBrowserAt.mockResolvedValue({ session_id: 't-abc' });
    render(<ChatView task={task('p-url', [{ id: 'u1', role: 'user', content: 'Hi' }])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Show browser' })[0]); });

    expect(openBrowserAt).toHaveBeenCalledWith('p-url', null);
    expect(embedBrowser).toHaveBeenCalledWith('t-abc');
    expect(screen.queryByRole('textbox', { name: 'Address' })).toBeNull();
  });

  it('keeps a browser still opening in one task from showing in the next', async () => {
    let opened;
    openBrowserAt.mockReturnValue(new Promise((resolve) => { opened = resolve; }));
    const { rerender } = render(<ChatView task={task('p-a', [{ id: 'u1', role: 'user', content: 'Hi' }])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show browser' })); });
    rerender(<ChatView task={task('p-b', [{ id: 'u2', role: 'user', content: 'Hello' }])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    await act(async () => { opened({ session_id: 't-a' }); });
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it('shows the pane with the start page at once while the browser opens, and keeps it closed if closed meanwhile', async () => {
    let opened;
    openBrowserAt.mockReturnValue(new Promise((resolve) => { opened = resolve; }));
    const onSend = vi.fn();
    render(<ChatView task={task('p-slow', [{ id: 'u1', role: 'user', content: 'Hi' }])} onSend={onSend} browserOn />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show browser' })); });

    expect(within(pane()).getByRole('status', { name: 'Opening your browser' })).toBeInTheDocument();
    expect(embedBrowser).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'What to look up' }), { target: { value: 'flights to Lisbon' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go' })); });
    expect(onSend).toHaveBeenCalledWith('Search the web in the browser for: flights to Lisbon');

    await act(async () => { fireEvent.click(within(pane()).getByRole('button', { name: /close/i })); });
    await act(async () => { opened({ session_id: 't-slow' }); });
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it("falls back to the start page when the task's browser can't open, which sends a search to Anton", async () => {
    openBrowserAt.mockRejectedValue(new Error('No browser is free'));
    const onSend = vi.fn();
    render(<ChatView task={task('p-none', [{ id: 'u1', role: 'user', content: 'Hi' }])} onSend={onSend} browserOn />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show browser' })); });

    expect(pane()).not.toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'What to look up' }), { target: { value: 'flights to Lisbon' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go' })); });
    expect(onSend).toHaveBeenCalledWith('Search the web in the browser for: flights to Lisbon');

    await act(async () => { fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' })); });
    expect(pane()).toBeNull();
  });

  it("opens when a voice call asks to show this task's browser, once: not again on coming back to the task", async () => {
    const request = { taskId: 'p-call', sessionId: 't-abc', at: 1 };
    const { rerender } = render(<ChatView task={task('p-call', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();

    rerender(<ChatView task={task('p-call', pastTurn)} onSend={vi.fn()} browserOn browserRequest={request} />);
    await act(async () => {});
    expect(pane()).not.toBeNull();

    await act(async () => { fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' })); });
    rerender(<ChatView task={task('p-other', pastTurn)} onSend={vi.fn()} browserOn browserRequest={request} />);
    await act(async () => {});
    rerender(<ChatView task={task('p-call', pastTurn)} onSend={vi.fn()} browserOn browserRequest={request} />);
    await act(async () => {});
    expect(pane()).toBeNull();
  });

  it('opens for a past Browser step only when the person clicks it', async () => {
    render(<ChatView task={task('p-on', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();

    await clickBrowserStep();
    expect(pane()).not.toBeNull();
    expect(embedBrowser).toHaveBeenCalledWith('t-abc');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing on a Browser step click while the browser is off, and never opens the scratchpad', async () => {
    render(<ChatView task={task('p-click-off', pastTurn)} onSend={vi.fn()} />);
    await clickBrowserStep();
    expect(pane()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens for the live turn\'s Browser step', async () => {
    render(<ChatView task={task('live-1', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(embedBrowser).toHaveBeenCalledWith('t-abc');
  });

  it('stays closed after the person closes it mid-turn, through the turn\'s end, until a later turn opens it', async () => {
    const asked = { id: 'u1', role: 'user', content: 'Go' };
    const { rerender } = render(<ChatView task={task('live-2', [asked, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' }));
    expect(pane()).toBeNull();

    const finished = [asked, { id: 'a1', role: 'assistant', content: 'Done.', steps: [step()] }];
    rerender(<ChatView task={task('live-2', finished)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();

    rerender(<ChatView task={task('live-2', [...finished, { id: 'u2', role: 'user', content: 'Again' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
  });

  it('comes back when the person clicks the Browser step after closing it mid-turn', async () => {
    render(<ChatView task={task('live-3', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' }));
    expect(pane()).toBeNull();
    await clickBrowserStep();
    expect(pane()).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("closes a past turn's pane when the browser is switched off, and starts over on a task change", async () => {
    const { rerender } = render(<ChatView task={task('sw-1', pastTurn)} onSend={vi.fn()} browserOn />);
    await clickBrowserStep();
    expect(pane()).not.toBeNull();
    rerender(<ChatView task={task('sw-1', pastTurn)} onSend={vi.fn()} browserOn={false} />);
    expect(pane()).toBeNull();

    rerender(<ChatView task={task('sw-1', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    rerender(<ChatView task={task('sw-2', pastTurn)} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
  });

  it("keeps the live turn's pane through a switch-off, until that turn ends", async () => {
    // Off applies from the next message: the running turn keeps its browser.
    const asked = { id: 'u1', role: 'user', content: 'Go' };
    const { rerender } = render(<ChatView task={task('sw-3', [asked, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    rerender(<ChatView task={task('sw-3', [asked, liveTurn()])} onSend={vi.fn()} browserOn={false} />);
    await act(async () => {});
    expect(pane()).not.toBeNull();

    const finished = [asked, { id: 'a1', role: 'assistant', content: 'Done.', steps: [step()] }];
    rerender(<ChatView task={task('sw-3', finished)} onSend={vi.fn()} browserOn={false} />);
    await act(async () => {});
    expect(pane()).toBeNull();
  });

  it("opens the live turn's session on a click while the browser is switched off", async () => {
    render(<ChatView task={task('sw-4', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn={false} />);
    await act(async () => {});
    expect(pane()).toBeNull();
    await clickBrowserStep();
    expect(pane()).not.toBeNull();
  });

  it('opens no pane on a desktop shell without the in-app browser', async () => {
    shell.isWeb = false;
    render(<ChatView task={task('desk', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it("opens the app's own browser on a desktop shell that hosts it, with no frame and no viewer link", async () => {
    shell.isWeb = false;
    shell.inApp = true;
    stageHasArea();
    const { container } = render(<ChatView task={task('desk-2', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(container.querySelector('aside[aria-label="Browser mode"] iframe')).toBeNull();
    expect(shell.shown).toEqual(['t-abc']);
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it('keeps the desktop pane shut while the browser is off for the task', async () => {
    shell.isWeb = false;
    shell.inApp = true;
    render(<ChatView task={task('desk-3', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn={false} />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(shell.shown).toEqual([]);
  });

  it('drops the viewer frame while the tab is hidden', async () => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    try {
      render(<ChatView task={task('vis-1', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />);
      await act(async () => {});
      expect(screen.getByTitle('Browser mode')).toBeInTheDocument();
      visibility = 'hidden';
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(screen.queryByTitle('Browser mode')).toBeNull();
    } finally {
      delete document.visibilityState;
    }
  });

  it('floats the pane at 1024 px, leaving the grid and the rail as they are', async () => {
    setWidth(1024);
    const { container } = render(
      <ChatView task={task('w-1', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />,
    );
    await act(async () => {});
    expect(pane()).not.toBeNull();
    expect(container.innerHTML).not.toContain('minmax(440px,50%)');
    expect(container.querySelector('.chat-rail-aside')).not.toHaveClass('hidden');
  });

  it('takes a grid column from 1160 px, with the rail stepping aside', async () => {
    setWidth(1160);
    const { container } = render(
      <ChatView task={task('w-2', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />,
    );
    await act(async () => {});
    expect(container.innerHTML).toContain('minmax(440px,50%)');
    expect(container.querySelector('.chat-rail-aside')).toHaveClass('hidden');
    // The docked rail can't show there, so nothing offers to expand it.
    expect(screen.queryByRole('button', { name: 'Expand panel' })).toBeNull();
  });

  it('opens the floating rail over the inline desktop pane at 1200 px, with the native view parked out of its way', async () => {
    shell.isWeb = false;
    shell.inApp = true;
    stageHasArea();
    observeWidth(885);
    setWidth(1200);
    const { container } = render(
      <ChatView task={task('w-3', [{ id: 'u1', role: 'user', content: 'Go' }, liveTurn()])} onSend={vi.fn()} browserOn />,
    );
    await act(async () => {});
    expect(container.innerHTML).toContain('minmax(440px,50%)');
    expect(shell.shown).toEqual(['t-abc']);
    const rail = container.querySelector('.chat-rail-aside');
    expect(rail).not.toHaveClass('hidden');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Expand panel' })); });
    expect(rail.style.transform).toBe('translateX(0)');
    // Parked, not hidden: the task stays the one the pane shows.
    expect(shell.bounds).toEqual([NOWHERE]);
    expect(shell.hides).toBe(0);

    await act(async () => { fireEvent.click(within(rail).getByRole('button', { name: 'Collapse panel' })); });
    expect(shell.bounds).toEqual([NOWHERE, { x: 600, y: 56, width: 600, height: 700 }]);
    expect(shell.shown).toEqual(['t-abc']);
    expect(shell.hides).toBe(0);
  });
});

describe("ChatView shared browser pane, shown only when the person is needed (the default)", () => {
  let iframeLoading;
  beforeEach(() => {
    shell.isWeb = true;
    shell.inApp = false;
    embedBrowser.mockReset();
    embedBrowser.mockResolvedValue({ session_id: 't-abc', view_url: VIEW, ticket_expires_at: 1_900_000_000, lease_expires_at: 1_900_000_780 });
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
    setWidth(1400);
    resetBrowserPrefsForTests();
  });
  afterEach(() => {
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
    setWidth(1024);
    vi.restoreAllMocks();
    resetBrowserPrefsForTests();
  });

  const asked = { id: 'u1', role: 'user', content: 'Go' };
  const card = (questionId, options) => ({
    id: `ask-${questionId}`, label: 'Question for you', badge: 'AskUser', status: 'in_progress', startedAt: 2,
    data: { question_id: questionId, prompt: 'Your turn', options },
  });
  const HELD = card('browser:approve:t-abc:pa-1', [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }, { value: 'cancel', label: 'Cancel' }]);
  const HAND_OVER = card('browser:9f2c', [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }]);
  const POSITION = card('browser:approve:t-abc:pa-2', [{ value: 'approve', label: 'Approve', detail: 'Allow clicks by position on this page' }]);
  const live = (...extra) => ({ ...liveTurn(), steps: [step(), ...extra] });

  it('stays closed while the agent browses', async () => {
    render(<ChatView task={task('n-1', [asked, live()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(embedBrowser).not.toHaveBeenCalled();
  });

  it('opens when a held step waits for the person, and again for the next card after they close it', async () => {
    const { rerender } = render(<ChatView task={task('n-2', [asked, live()])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    rerender(<ChatView task={task('n-2', [asked, live(HELD)])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
    fireEvent.click(within(pane()).getByRole('button', { name: 'Close browser' }));
    expect(pane()).toBeNull();
    rerender(<ChatView task={task('n-2', [asked, live({ ...HELD, data: { ...HELD.data, answer: { status: 'answered', values: ['approve'] } } }, HAND_OVER)])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
  });

  it('opens for a hand-over (a sign-in, a CAPTCHA), but not for a click by position the app approves', async () => {
    const { unmount } = render(<ChatView task={task('n-3', [asked, live(POSITION)])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).toBeNull();
    unmount();
    render(<ChatView task={task('n-4', [asked, live(HAND_OVER)])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(pane()).not.toBeNull();
  });

  it("still opens from the browser button, and shows the turn's browser steps as one row", async () => {
    const call = (id, label, status = 'completed') => ({ id, label, badge: BROWSER_ACTION_BADGE, icon: 'globe', status, startedAt: 1, completedAt: status === 'completed' ? 2 : null });
    const turn = live(call('s2', 'Opening united.com'), call('s3', 'Find flights to Boston', 'in_progress'));
    render(<ChatView task={task('n-5', [asked, turn])} onSend={vi.fn()} browserOn />);
    await act(async () => {});
    expect(screen.queryByText('Opening united.com')).toBeNull();
    expect(screen.queryByText('Opened the browser')).toBeNull();
    expect(screen.getAllByText('Find flights to Boston').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show browser' })); });
    expect(pane()).not.toBeNull();
  });
});
