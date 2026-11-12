/*
 * The shared browser's Browser switch and pane through App, as GET
 * /browse/status answers. A status answer that turns false only hides the +
 * menu's switch: a task started from Home keeps the Off the person set. A
 * task's pane and its web warm-up open only where the browser is offered, so
 * an account it isn't offered to opens no pane for an old Browser step and
 * starts no browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSessionResult: vi.fn(),
  fetchBrowseStatus: vi.fn(),
  provisionBrowser: vi.fn(),
  embedBrowser: vi.fn(),
  openBrowserAt: vi.fn(),
}));

const streams = [];

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: vi.fn(async (id) => ({ id, messages: [], hasMoreMessages: false, messagesCursor: null })),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
  fetchOlderMessages: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchComparisons: vi.fn(async () => ({ comparisons: [], hasMore: false })),
  fetchArtifacts: vi.fn(async () => []),
  // The browser is off until turned on (Beta): these tests turn it on.
  fetchSettings: vi.fn(async () => ({ configReady: true, browserEnabled: true })),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => null),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  fetchBrowseStatus: (...args) => spies.fetchBrowseStatus(...args),
  provisionBrowser: (...args) => spies.provisionBrowser(...args),
  embedBrowser: (...args) => spies.embedBrowser(...args),
  openBrowserAt: (...args) => spies.openBrowserAt(...args),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  cancelResponse: vi.fn(async () => ({})),
  streamNewSession: (...args) => {
    const handle = { kind: 'new', text: args[0], opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
  streamMessage: (...args) => {
    const handle = { kind: 'reply', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
}));

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: true,
      supportsInAppBrowser: false,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: () => () => {},
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
      removeCodingTask: vi.fn(async () => ({})),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

vi.mock('./code/codeModeAccess', async (importOriginal) => ({
  ...(await importOriginal()),
  useCodeModeAccess: () => ({ available: false, enabled: false, state: 'disabled', setEnabled: () => {} }),
}));
vi.mock('./code/CodeView', () => ({ default: () => null }));
vi.mock('./code/useCodeModeLifecycle', () => ({ useCodeModeLifecycle: () => {} }));

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';
import { browserStep } from './lib/browserSession';

const AVAILABLE = { enabled: true, available: true, status: 'none' };
const NOT_ENTITLED = { enabled: true, available: false, status: 'not_entitled' };

const width = window.innerWidth;
let iframeLoading;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  __resetDraftsForTests();
  streams.length = 0;
  spies.fetchSessions.mockReset().mockResolvedValue([]);
  spies.fetchSessionResult.mockReset();
  spies.fetchBrowseStatus.mockReset();
  spies.provisionBrowser.mockReset().mockResolvedValue({ status: 'starting' });
  spies.openBrowserAt.mockReset().mockResolvedValue({ session_id: 't-abc' });
  spies.embedBrowser.mockReset().mockResolvedValue({
    session_id: 't-abc',
    view_url: `${window.location.origin}/browser/sessions/t-abc/view?et=tok`,
    ticket_expires_at: 1_900_000_000,
    lease_expires_at: 1_900_000_780,
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
  iframeLoading = window.happyDOM.settings.disableIframePageLoading;
  window.happyDOM.settings.disableIframePageLoading = true;
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.happyDOM.settings.disableIframePageLoading = iframeLoading;
});

function savedTask(id, messages) {
  return { id, title: `Task ${id}`, status: 'idle', projectName: 'general', hasMoreMessages: false, messagesCursor: null, messages };
}

/* Opens a task, so App has seen the backend online, then goes Home, where
   HomeView mounts straight at its composer. */
async function openHomeComposer(user) {
  spies.fetchSessions.mockResolvedValue([{ id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' }]);
  spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: savedTask('conv-a', []) });
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  await user.click(screen.getByRole('button', { name: /new task/i }));
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

function pane() {
  return screen.queryByRole('complementary', { name: 'Shared browser' });
}

describe('the Browser switch and pane through App', () => {
  it("keeps the person's Off for a task started from Home after a re-ask hides the switch", async () => {
    spies.fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    const user = userEvent.setup();
    const composer = await openHomeComposer(user);

    await user.click(screen.getByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('switch', { name: 'Turn the browser off for this task' }));
    expect(screen.getByRole('switch', { name: 'Turn the browser on for this task' })).toBeInTheDocument();

    // The window gets focus, and this read answers that the browser isn't offered now.
    spies.fetchBrowseStatus.mockResolvedValue(NOT_ENTITLED);
    const asked = spies.fetchBrowseStatus.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(spies.fetchBrowseStatus.mock.calls.length).toBeGreaterThan(asked));
    await waitFor(() => expect(screen.queryByRole('switch', { name: /the browser (on|off) for this task/ })).toBeNull());

    await user.click(composer);
    await user.keyboard('Check the site{Enter}');
    await waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0].kind).toBe('new');
    expect(streams[0].opts.browserOff).toBe(true);
  });

  it.each([
    ['not offered to the account', NOT_ENTITLED, 'conv-not-offered', false],
    ['offered', AVAILABLE, 'conv-offered', true],
  ])('opens the pane for a past Browser step, and warms the browser, only where it is offered: %s', async (_name, status, id, opens) => {
    spies.fetchBrowseStatus.mockResolvedValue(status);
    spies.fetchSessions.mockResolvedValue([{ id, title: `Task ${id}`, messages: [], status: 'idle', projectName: 'general' }]);
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: savedTask(id, [
        { id: 'u1', role: 'user', content: 'Check the site' },
        { id: 'a1', role: 'assistant', content: 'Done.', steps: [browserStep({ session_id: 't-abc' }, 1)] },
      ]),
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(spies.fetchBrowseStatus).toHaveBeenCalled());
    await user.click(await screen.findByText(`Task ${id}`));

    // The transcript folds a turn's steps: unfold them, then click the Browser step.
    await screen.findAllByText('Done.');
    if (!screen.queryAllByText('Opened the browser').length) {
      const toggle = screen.getAllByRole('button', { expanded: false }).find((b) => b.closest('.answer-turn'));
      await act(async () => { fireEvent.click(toggle); });
    }
    await act(async () => { fireEvent.click(screen.getAllByText('Opened the browser')[0]); });
    await act(async () => {});

    if (opens) {
      expect(pane()).not.toBeNull();
      expect(spies.embedBrowser).toHaveBeenCalledWith('t-abc');
      expect(spies.provisionBrowser).toHaveBeenCalled();
    } else {
      expect(pane()).toBeNull();
      expect(spies.embedBrowser).not.toHaveBeenCalled();
      expect(spies.provisionBrowser).not.toHaveBeenCalled();
    }
  });

  it('a task sent from Home with the browser beside it on a page names its site, and opens its browser there', async () => {
    spies.fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    const user = userEvent.setup();
    const composer = await openHomeComposer(user);
    await user.click(screen.getByRole('button', { name: 'Show browser' }));
    // Beside Home, not over it: the composer stays usable.
    const frame = await waitFor(() => {
      const found = pane()?.querySelector('iframe');
      if (!found) throw new Error('no viewer yet');
      return found;
    });
    expect(pane()).not.toHaveClass('is-floating');
    const win = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'browser-viewer-ready' }, source: win }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'browser-viewer-url', url: 'https://www.united.com/en/us?f=SFO&t=WAS' }, source: win }));
    });

    await user.click(composer);
    await user.keyboard('Find nonstop flights to DC{Enter}');
    await waitFor(() => expect(streams).toHaveLength(1));
    const { text, opts } = streams[0];
    expect(text).toMatch(/^Find nonstop flights to DC\n\n\[The browser beside this request/);
    // The prompt names only the site's origin, never text the site chose (its
    // path or query); the task's browser reopens the whole page, its search kept.
    expect(text).toContain('a page from https://www.united.com open in the shared browser');
    expect(text).not.toContain('/en/us');
    expect(text).not.toContain('f=SFO');
    expect(opts.conversationId).toBeTruthy();
    await waitFor(() => expect(spies.openBrowserAt).toHaveBeenCalledWith(opts.conversationId, 'https://www.united.com/en/us?f=SFO&t=WAS'));
  });

  it("a question from the viewer's address bar lands in Home's composer, unsent", async () => {
    spies.fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    const user = userEvent.setup();
    const composer = await openHomeComposer(user);
    await user.click(screen.getByRole('button', { name: 'Show browser' }));
    const frame = await waitFor(() => {
      const found = pane()?.querySelector('iframe');
      if (!found) throw new Error('no viewer yet');
      return found;
    });
    const win = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'browser-viewer-ready' }, source: win }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'browser-viewer-ask', text: 'email the files to me' }, source: win }));
    });
    await waitFor(() => expect(composer.value).toBe('Search the web in the browser for: email the files to me'));
    expect(streams).toHaveLength(0);
  });
});
