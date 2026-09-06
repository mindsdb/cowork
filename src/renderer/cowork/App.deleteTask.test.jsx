// A refused delete must restore the row and clear its optimistic tombstone; logging alone leaves it
// hidden until reload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => {
  const sessions = [
    { id: 'conv-a', title: 'Daily report run', messages: [], status: 'idle', projectName: 'general' },
    { id: 'conv-b', title: 'Unrelated chat', messages: [], status: 'idle', projectName: 'general' },
  ];
  return {
    sessions,
    deleteConversation: vi.fn(),
    fetchSessions: vi.fn(),
  };
});

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: vi.fn(async () => ({ messages: [] })),
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
  unpinTask: vi.fn(async () => ({})),
  deleteConversation: (...args) => spies.deleteConversation(...args),
}));

// Spread the real web-safe host and override mount dependencies; isElectron:false keeps real
// methods off the bridge.
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

/**
 * Hover the scoped row with fireEvent before clicking its pointer-disabled kebab.
 * Run beforeConfirm after mount fetches settle to install the delete-time response fixture.
 */
async function deleteFromSidebar(user, title, { beforeConfirm } = {}) {
  render(<App />);
  const row = await screen.findByRole('button', { name: title });
  fireEvent.mouseOver(row.parentElement);
  await user.click(within(row.parentElement).getByRole('button', { name: 'Task menu' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  if (beforeConfirm) beforeConfirm();
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  __resetDraftsForTests();
  spies.deleteConversation.mockReset().mockResolvedValue({ ok: true });
  spies.fetchSessions.mockReset().mockImplementation(
    async () => spies.sessions.map((s) => ({ ...s })),
  );
});

describe('deleting a chat from the sidebar', () => {
  it('puts the row back and says so when the server refuses', async () => {
    const user = userEvent.setup();
    spies.deleteConversation.mockRejectedValue(new Error('Delete failed (500)'));

    await deleteFromSidebar(user, 'Daily report run');

    // The refusal has to reach the user, and the row has to come back. A
    // reload is not allowed to be how they find out.
    expect(await screen.findByText(/Couldn't delete this chat/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Daily report run' })).toBeTruthy();
    });
    expect(spies.deleteConversation).toHaveBeenCalledWith('conv-a');
  });

  it('leaves the row gone and stays quiet when the server accepts', async () => {
    const user = userEvent.setup();

    await deleteFromSidebar(user, 'Daily report run');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Daily report run' })).toBeNull();
    });
    // The negative case: a successful delete must not toast.
    expect(screen.queryByText(/Couldn't delete this chat/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Unrelated chat' })).toBeTruthy();

    // Refetch through projects-changed while the mock still lists the deleted row to prove the
    // successful tombstone survives stale server data.
    const callsBefore = spies.fetchSessions.mock.calls.length;
    window.dispatchEvent(new Event('anton:projects-changed'));
    await waitFor(() => {
      expect(spies.fetchSessions.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Daily report run' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unrelated chat' })).toBeTruthy();
  });

  it('keeps the rest of the list when the restore refetch also fails', async () => {
    const user = userEvent.setup();
    spies.deleteConversation.mockRejectedValue(new Error('Delete failed (500)'));

    // An empty successful refetch cannot restore the row; rollback must reinsert the captured task.
    await deleteFromSidebar(user, 'Daily report run', {
      beforeConfirm: () => spies.fetchSessions.mockResolvedValue([]),
    });

    expect(await screen.findByText(/Couldn't delete this chat/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Daily report run' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Unrelated chat' })).toBeTruthy();
  });

  it('keeps the rest of the list when the restore refetch fails outright', async () => {
    const user = userEvent.setup();
    spies.deleteConversation.mockRejectedValue(new Error('Delete failed (500)'));

    // A failed list returns {error:true}; rollback must reinsert the captured task.
    // This proves reinsertion, not the array-shape guard: mergeTasksFromServer already tolerates
    // non-array input.
    await deleteFromSidebar(user, 'Daily report run', {
      beforeConfirm: () => spies.fetchSessions.mockResolvedValue({ error: true, status: 500 }),
    });

    expect(await screen.findByText(/Couldn't delete this chat/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Daily report run' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Unrelated chat' })).toBeTruthy();
  });
});

describe('the recents list tells loading, empty and failed apart end-to-end (ENG-2246)', () => {
  // Mount App to verify task-status wiring; isolated Sidebar and API tests cannot detect omitted
  // state updates.
  it('shows a retry when the list fetch fails, and recovers when it succeeds', async () => {
    const user = userEvent.setup();
    spies.fetchSessions.mockReset().mockResolvedValue({ error: true, status: 500 });

    render(<App />);

    // Failure must be visibly distinct from an empty account.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();

    // Retry has to actually re-fetch and clear the error.
    spies.fetchSessions.mockResolvedValue(spies.sessions.map((s) => ({ ...s })));
    await user.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Daily report run' })).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warms the transcripts once per session, not once per refreshData', async () => {
    // Claim warm-up before fetchHealth can reenter refreshData through serverOnline, or desktop
    // cold boot fetches every transcript twice.
    spies.fetchSessions.mockReset().mockImplementation(
      async () => spies.sessions.map((s) => ({ ...s })),
    );

    render(<App />);
    await screen.findByRole('button', { name: 'Daily report run' });

    const warming = spies.fetchSessions.mock.calls.filter(([opts]) => opts && opts.onItems);
    expect(warming).toHaveLength(1);
  });

  it('still warms after a failed first list — the claim is released', async () => {
    // Release the synchronous warm-up claim after list failure so Retry can warm transcripts.
    const user = userEvent.setup();
    spies.fetchSessions.mockReset().mockResolvedValue({ error: true, status: 500 });

    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(spies.fetchSessions.mock.calls.filter(([o]) => o && o.onItems)).not.toHaveLength(0);

    const before = spies.fetchSessions.mock.calls.length;
    spies.fetchSessions.mockResolvedValue(spies.sessions.map((s) => ({ ...s })));
    await user.click(screen.getByText('Retry'));
    await screen.findByRole('button', { name: 'Daily report run' });

    const afterRetry = spies.fetchSessions.mock.calls.slice(before);
    expect(afterRetry.filter(([o]) => o && o.onItems)).not.toHaveLength(0);
  });

  it('recovering into a genuinely empty account says so, and drops the alert', async () => {
    // Retry from failure to an empty account must replace the alert with the empty state.
    const user = userEvent.setup();
    spies.fetchSessions.mockReset().mockResolvedValue({ error: true, status: 503 });

    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();

    spies.fetchSessions.mockResolvedValue([]);
    await user.click(screen.getByText('Retry'));

    expect(await screen.findByText('No tasks yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
