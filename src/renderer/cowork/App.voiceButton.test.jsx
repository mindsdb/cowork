/*
 * The voice call's round button through App, as GET /voice/status answers:
 * hidden where live voice isn't served (never a disabled button), and shown
 * once a read that failed is asked again and answers yes (ENG-4138).
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
  fetchVoiceStatus: vi.fn(),
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
  fetchVoiceStatus: (...args) => spies.fetchVoiceStatus(...args),
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

const callButton = () => document.querySelector('.voice-launcher__button');

describe("the voice call's button through App", () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows no button, not a disabled one, where live voice is not served', async () => {
    spies.fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    spies.fetchVoiceStatus.mockReset().mockResolvedValue({ available: false });
    render(<App />);
    await waitFor(() => expect(spies.fetchVoiceStatus).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(callButton()).toBeNull();
    expect(screen.queryByLabelText(/available here yet/)).toBeNull();
  });

  it('asks again after a failed read, and shows the button once it says yes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    spies.fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    let served = false;
    spies.fetchVoiceStatus.mockReset()
      .mockImplementation(async () => (served ? { available: true } : { available: false, failed: true }));
    render(<App />);
    await waitFor(() => expect(spies.fetchVoiceStatus).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(callButton()).toBeNull();
    const asked = spies.fetchVoiceStatus.mock.calls.length;
    served = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(spies.fetchVoiceStatus.mock.calls.length).toBeGreaterThan(asked);
    await waitFor(() => expect(callButton()).not.toBeNull());
    expect(callButton()).not.toHaveAttribute('aria-disabled');
  });
});
