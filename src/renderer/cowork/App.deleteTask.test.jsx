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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteConversation: vi.fn(async () => ({ ok: true })),
  fetchSessions: vi.fn(async () => [
    { id: 'conv-a', title: 'Daily report run', messages: [], status: 'idle', projectName: 'general' },
    { id: 'conv-b', title: 'Unrelated chat', messages: [], status: 'idle', projectName: 'general' },
  ]),
}));

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
 *  Every row has a kebab, hence scoping the lookup to this row. */
async function deleteFromSidebar(user, title) {
  render(<App />);
  const row = await screen.findByRole('button', { name: title });
  fireEvent.mouseOver(row.parentElement);
  await user.click(within(row.parentElement).getByRole('button', { name: 'Task menu' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  __resetDraftsForTests();
  spies.deleteConversation.mockReset().mockResolvedValue({ ok: true });
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
    // The negative case: a successful delete must not toast, and the tombstone
    // must survive the refetch that follows it, or the row comes straight back.
    expect(screen.queryByText(/Couldn't delete this chat/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Unrelated chat' })).toBeTruthy();
  });
});
