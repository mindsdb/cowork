// A page fetched via fetchOlderMessages carries the SAME raw item shape
// the first page does (events inline, not yet hydrated into steps or a
// synthetic error/provider_required row) — fetchSession/fetchSessionResult
// hydrate the first page at the api boundary (_hydrateAssistantEvents), but
// handleLoadEarlierMessages prepended the older page's raw items directly.
// A turn that failed before producing text rendered as an empty assistant
// bubble instead of its error card once loaded this way, even though the
// exact same turn renders correctly as part of the first page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
  fetchOlderMessages: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
  fetchOlderMessages: (...args) => spies.fetchOlderMessages(...args),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  pinTask: vi.fn(async () => ({})),
  unpinTask: vi.fn(async () => ({})),
}));

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
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

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';

const baseTask = (overrides = {}) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'idle',
  projectName: 'general',
  hasMoreMessages: false,
  messagesCursor: null,
  messages: [],
  ...overrides,
});

async function openTask(user) {
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  spies.fetchSessions.mockReset().mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  spies.fetchSession.mockReset().mockResolvedValue({ id: 'conv-a', messages: [], hasMoreMessages: false, messagesCursor: null });
  spies.fetchSessionResult.mockReset();
  spies.fetchOlderMessages.mockReset();
});

describe('loading earlier messages hydrates the page like the first one does', () => {
  it('renders a failed older turn\'s error card instead of an empty bubble', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        hasMoreMessages: true,
        messagesCursor: 'cursor-1',
        messages: [
          { role: 'user', id: 'u2', content: 'Second question' },
          { role: 'assistant', id: 'a2', content: 'Second answer' },
        ],
      }),
    });
    // Raw, unhydrated shape — exactly what the server's /items envelope
    // sends: the failed turn's assistant row has empty content and its
    // failure lives in `events`, not yet replayed into a steps/error split.
    spies.fetchOlderMessages.mockResolvedValue({
      messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        {
          role: 'assistant', id: 'a1', content: '',
          events: [{ type: 'response.failed', code: 'rate_limited', error: 'Too many requests' }],
        },
      ],
      hasMoreMessages: false,
      messagesCursor: null,
    });

    await openTask(user);
    await screen.findByText('Second answer');

    await user.click(screen.getByText('Load earlier messages'));

    await waitFor(() => {
      expect(screen.getByText('First question')).toBeInTheDocument();
    });
    // The whole point: the failed turn's error card, not a blank bubble.
    expect(screen.getByText('Too many requests')).toBeInTheDocument();
  });

  it('shows a toast and leaves the affordance clickable again when the fetch fails', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        hasMoreMessages: true,
        messagesCursor: 'cursor-1',
        messages: [
          { role: 'user', id: 'u1', content: 'Only question' },
          { role: 'assistant', id: 'a1', content: 'Only answer' },
        ],
      }),
    });
    spies.fetchOlderMessages.mockResolvedValue(null);

    await openTask(user);
    await screen.findByText('Only answer');
    await user.click(screen.getByText('Load earlier messages'));

    expect(await screen.findByText(/Couldn't load earlier messages/)).toBeInTheDocument();
    expect(screen.getByText('Load earlier messages')).toBeInTheDocument();
  });

  it('does not let the scroll trigger retry a cursor that just failed', async () => {
    // The sentinel stays on screen after a failed fetch (nothing was
    // prepended), so an unguarded observer re-fires the moment the in-flight
    // flag clears — a tight request loop against an already-failing server,
    // stacking one toast per attempt. A click is still allowed to retry.
    const user = userEvent.setup();
    const observers = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() {}
    };
    try {
      spies.fetchSessionResult.mockResolvedValue({
        status: 'ok',
        task: baseTask({
          hasMoreMessages: true,
          messagesCursor: 'cursor-1',
          messages: [
            { role: 'user', id: 'u1', content: 'Only question' },
            { role: 'assistant', id: 'a1', content: 'Only answer' },
          ],
        }),
      });
      spies.fetchOlderMessages.mockResolvedValue(null);

      await openTask(user);
      await screen.findByText('Only answer');

      const fire = async () => {
        await act(async () => {
          observers[observers.length - 1].cb([{ isIntersecting: true }]);
          await Promise.resolve();
        });
      };

      await fire();
      await waitFor(() => expect(spies.fetchOlderMessages).toHaveBeenCalledTimes(1));

      // Every further automatic attempt at the same cursor is suppressed.
      await fire();
      await fire();
      await fire();
      expect(spies.fetchOlderMessages).toHaveBeenCalledTimes(1);

      // The button is still a manual retry.
      await user.click(screen.getByText('Load earlier messages'));
      await waitFor(() => expect(spies.fetchOlderMessages).toHaveBeenCalledTimes(2));
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  it('keeps the affordance when the warm-up loaded only a page of a long conversation', async () => {
    // The warm-up now fetches a page, not the whole history, so the boundary
    // has to come from what it actually loaded. Hardcoding "nothing more to
    // load" here is what hid "load earlier" on every recently-opened task:
    // reconcilePaginationState treats a non-null false as an established
    // boundary and keeps it through every later refetch.
    const user = userEvent.setup();
    // The real fetchSessions reports each warmed transcript AFTER the list has
    // resolved, so capture the callback and fire it once the task exists —
    // calling it inline would warm a task that is not in state yet.
    let reportWarmed = null;
    spies.fetchSessions.mockImplementation(async (opts) => {
      if (opts?.onItems) reportWarmed = opts.onItems;
      return [{ id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' }];
    });
    // The open path deliberately reports NO further history, so the warm-up is
    // the only thing that can supply the boundary. reconcilePaginationState
    // keeps whatever the task already established, so if warmTranscript
    // hardcodes false the affordance never appears.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        hasMoreMessages: false,
        messagesCursor: null,
        messages: [{ role: 'user', id: 'u50', content: 'Newest page question' }],
      }),
    });

    render(<App />);
    await screen.findByText('Alpha task');
    await waitFor(() => expect(reportWarmed).toBeTypeOf('function'));
    await act(async () => {
      reportWarmed(
        'conv-a',
        [{ role: 'user', id: 'u50', content: 'Newest page question' }],
        { hasMoreMessages: true, messagesCursor: 'cursor-deep' },
      );
      await Promise.resolve();
    });

    await user.click(screen.getByText('Alpha task'));
    await screen.findByText('Newest page question');

    expect(await screen.findByText('Load earlier messages')).toBeInTheDocument();
  });

  it('lets the scroll trigger try again after the conversation is reopened', async () => {
    // The failed-cursor guard exists to stop a tight request loop, but the
    // cursor it failed on is deliberately preserved across later refetches, so
    // without clearing it on open one transient failure disables scroll
    // loading for the life of the mount.
    const user = userEvent.setup();
    const observers = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() {}
    };
    try {
      spies.fetchSessionResult.mockResolvedValue({
        status: 'ok',
        task: baseTask({
          hasMoreMessages: true,
          messagesCursor: 'cursor-1',
          messages: [{ role: 'user', id: 'u1', content: 'Only question' }],
        }),
      });
      spies.fetchOlderMessages.mockResolvedValue(null);

      await openTask(user);
      await screen.findByText('Only question');

      const fire = async () => {
        await act(async () => {
          observers[observers.length - 1].cb([{ isIntersecting: true }]);
          await Promise.resolve();
        });
      };

      await fire();
      await waitFor(() => expect(spies.fetchOlderMessages).toHaveBeenCalledTimes(1));
      await fire();
      expect(spies.fetchOlderMessages).toHaveBeenCalledTimes(1);   // guard holds

      // Leave the conversation and come back: a fresh open is a fresh intent.
      await user.click(await screen.findByText('New task'));
      await user.click(await screen.findByText('Alpha task'));
      await screen.findByText('Only question');

      await fire();
      await waitFor(() => expect(spies.fetchOlderMessages).toHaveBeenCalledTimes(2));
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });
});
