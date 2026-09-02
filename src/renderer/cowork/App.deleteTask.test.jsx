// A chat delete the server refuses used to read as success: the row is hidden
// before the call, the failure went to console.error, and the tombstone in
// deletedTaskIdsRef kept the row hidden for the life of the mount. The user
// deleted the same chat again on their next visit and only found out on a
// reload. Nothing but this test stands between the rollback and that silence.
//
// Mounting pattern copied from App.keyProvisioning.test.jsx, which took it from
// App.askUser.send.test.jsx, because performDeleteTask is an inner closure and
// not an exported helper. Third copy of the block; a shared fixture is worth
// doing on the next one.
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

// Spread the real host and override only what a mount needs. isElectron stays
// false, so every real host method returns its no-Electron default rather than
// reaching for a bridge.
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

/** Mounts App and drives the sidebar's Delete all the way through the confirm.
 *
 *  The kebab is revealed on hover and carries `pointer-events: none` until then,
 *  so the row has to be entered before it can be clicked. fireEvent rather than
 *  user.hover: userEvent's pointer model refuses to move onto an element that
 *  still has pointer-events none, which is the very state the hover clears.
 *  Every row has a kebab, hence scoping the lookup to this row.
 *
 *  `beforeConfirm` runs after the mount's own fetches have settled and right
 *  before the confirm click — the seam for re-pointing a mock at the state
 *  the delete itself should see. */
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

    // The tombstone must survive a later refetch, or the row comes straight
    // back: the server still lists the conversation until its delete
    // propagates everywhere, and the mock here still returns it. Nothing in
    // the delete flow itself refetches on success, so drive one through the
    // projects-changed listener, the same consumer path the app uses.
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

    // fetchSessions resolves rather than rejecting: `[]` for an empty
    // account, `{ error: true }` for a failed list (ENG-2246). This is the
    // empty-answer arm — the delete failing AND the refetch coming back
    // empty. The restore must re-seat the deleted row from the captured
    // task, not blank the sidebar with the empty answer.
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

    // The other arm: since ENG-2246 a failed list resolves `{ error: true }`,
    // not `[]`. What this pins is the re-seat — the toast says the chat is
    // back in the list, and on this path the refetch brings nothing to put
    // it back with. Mutation-verified: dropping the `merged.unshift(task)`
    // re-seat fails this test and its empty-answer sibling.
    //
    // It does NOT pin the shape guard above it. mergeTasksFromServer returns
    // `local` for any non-array input, so passing the error object straight
    // through would also be safe — checked by mutation before writing this.
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
