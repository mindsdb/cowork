/* Connections the server marks managed (the operator's own, or one someone
   else shares) are read-only on the Connections page. The creator's own shared
   connection keeps every control and reconnects without deleting it first.
   Disconnecting is the card's own flow, so the panel has no Remove. A Reconnect whose delete fails
   never opens a new connect flow, while one whose connection is already gone
   does.
   Follows CustomizeView.identity.test.jsx's mocking convention, on the web
   host the self-hosted stack serves unless a test switches the host to desktop. */

import { beforeEach, afterEach, describe, it, expect, onTestFinished, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* The panel's note and cowork-server's 403 (SHARED_CONNECTION_REFUSAL in
   cowork/services/connectors/layered_vault.py) share this sentence. */
const READ_ONLY_NOTE = "This connection is shared with you and can't be changed here.";
const OPERATOR_NOTE = "Your operator provides this connection, and it can't be changed here.";
const OWN_SHARED_CHANGE_NOTE = "It's shared, so your changes reach everyone it's shared with at their next answer.";

/* google_drive plus an MCP method so one panel would show every control the
   managed state hides: the Drive picker, the access-mode select and
   Reconnect. */
const CONNECTION = {
  engine: 'google_drive', name: 'google_drive-team', label: 'Google Drive',
  user_label: null, display_name: 'team@example.com',
};
const SPEC = {
  label: 'Google Drive',
  form: { methods: [{ id: 'mcp', label: 'In-Browser Connect', fields: [] }] },
};
const SAVED = {
  method: 'mcp',
  fields: { _access_mode: 'read', account_email: 'team@example.com' },
  secureKeys: [],
};

const state = vi.hoisted(() => ({ connections: [], saved: null }));
const host = vi.hoisted(() => ({
  isWeb: true, isElectron: false, isMac: () => false,
  openExternal: vi.fn(), keychainRevoke: vi.fn(), pickDriveFiles: vi.fn(), cancelDrivePicker: vi.fn(),
}));

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: '__KEEP__',
  deleteDatasource: vi.fn(),
  fetchConnector: vi.fn(),
  fetchDatasources: vi.fn(),
  fetchSavedConnection: vi.fn(),
  patchConnectionAccessMode: vi.fn(),
}));
vi.mock('../../platform/host', () => ({ host }));

import CustomizeView from './CustomizeView';
import { deleteDatasource, fetchConnector, fetchDatasources, fetchSavedConnection } from '../api';

beforeEach(() => {
  host.isWeb = true;
  host.isElectron = false;
  host.keychainRevoke.mockReset();
  vi.mocked(deleteDatasource).mockReset();
  vi.mocked(fetchConnector).mockReset().mockImplementation(() => Promise.resolve(SPEC));
  /* The view refetches on mount and replaces its list, so this must return the
     same fixtures the test renders with. */
  vi.mocked(fetchDatasources).mockReset().mockImplementation(() => Promise.resolve({ connections: state.connections }));
  vi.mocked(fetchSavedConnection).mockReset().mockImplementation(() => Promise.resolve(state.saved));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function refusal(status, message) {
  return Object.assign(new Error(message), { status });
}

async function openPanel(connections, saved, props = {}) {
  state.connections = connections;
  state.saved = saved;
  render(<CustomizeView connectors={connections} {...props} />);
  // A read-only card is named View, every other one Manage.
  await userEvent.click(screen.getByRole('button', { name: /^(Manage|View) Google Drive/ }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument());
  return dialog;
}

/* Clicks the panel's Reconnect, then answers its confirm dialog. Returns the
   confirm dialog's text. */
async function reconnect(panel, answer = 'Reconnect') {
  await userEvent.click(within(panel).getByRole('button', { name: 'Reconnect' }));
  const confirm = await screen.findByRole('dialog', { name: 'Reconnect Google Drive?' });
  const text = confirm.textContent;
  await userEvent.click(within(confirm).getByRole('button', { name: answer }));
  return text;
}

const PLAIN_RECONNECT = "The existing connection will be removed and you'll connect it again from scratch.";
const SHARED_RECONNECT = "It's shared, so connect the same account to update it in place for everyone it's shared with.";

describe('CustomizeView managed and shared connections', () => {
  it.each([
    ['the list row', { ...CONNECTION, managed: true }, SAVED, OPERATOR_NOTE],
    ['the detail response', CONNECTION, { ...SAVED, managed: true }, OPERATOR_NOTE],
    ['the list row of a connection shared with the caller', { ...CONNECTION, managed: true, shared: true }, { ...SAVED, managed: true, shared: true }, READ_ONLY_NOTE],
  ])('shows the panel read-only when %s marks the connection managed', async (_, connection, saved, note) => {
    const dialog = await openPanel([connection], saved);

    expect(within(dialog).getByRole('note')).toHaveTextContent(note);
    expect(within(dialog).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Tool access')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Select files from Google Drive' })).not.toBeInTheDocument();
    // What the connection is stays visible.
    expect(within(dialog).getByText('Engine')).toBeInTheDocument();
  });

  it.each([
    ['managed card', { ...CONNECTION, managed: true }, 'Managed', 'Shared'],
    ['card of a connection shared with the caller', { ...CONNECTION, managed: true, shared: true }, 'Shared', 'Managed'],
  ])('shows its badge, a View name and no Disconnect on the %s', (_, managed, badge, otherBadge) => {
    state.connections = [managed];
    render(<CustomizeView connectors={[managed]} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText(badge)).toBeInTheDocument();
    expect(within(card).queryByText(otherBadge)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^View Google Drive/ })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it("shows the Shared badge and every control on the creator's own shared connection", async () => {
    const shared = { ...CONNECTION, managed: false, shared: true };
    const dialog = await openPanel([shared], { ...SAVED, managed: false, shared: true });

    // The open panel hides the page behind it from the accessibility tree.
    const card = screen.getByRole('article', { hidden: true });
    expect(within(card).getByText('Shared')).toBeInTheDocument();
    expect(within(card).queryByText('Managed')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Disconnect', hidden: true })).toBeInTheDocument();
    // Tool access says a change reaches everyone; nothing says read-only.
    expect(within(dialog).getByRole('note')).toHaveTextContent(OWN_SHARED_CHANGE_NOTE);
    expect(within(dialog).queryByText(READ_ONLY_NOTE)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(dialog).getByText('Tool access')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Select files from Google Drive' })).toBeInTheDocument();
  });

  it.each([
    ['a connection shared with the caller', { ...CONNECTION, managed: true, shared: true }, { managed: true, shared: true },
      'Whoever shared it with you can reconnect it.', 'Reconnect to restore access'],
    ['a connection the operator provides', { ...CONNECTION, managed: true }, { managed: true },
      'Your operator can reconnect it.', 'Whoever shared it with you'],
    ["the creator's own shared connection", { ...CONNECTION, managed: false, shared: true }, { managed: false, shared: true },
      'Reconnect to restore access, or disconnect it from its card.', 'Whoever shared it with you'],
    ['a connection without either field', CONNECTION, {},
      'Reconnect to restore access, or disconnect it from its card.', 'Whoever shared it with you'],
  ])('tells the reader of %s that needs reconnecting who can reconnect it', async (_, connection, flags, says, omits) => {
    const saved = { ...SAVED, ...flags, fields: { ...SAVED.fields, status: 'needs_reconnect' } };
    const dialog = await openPanel([connection], saved);

    expect(within(dialog).getByText('Reconnection required')).toBeInTheDocument();
    expect(within(dialog).getByText(/Access for this connection has expired or was revoked\./))
      .toHaveTextContent(says);
    expect(within(dialog).queryByText(new RegExp(omits))).not.toBeInTheDocument();
  });

  it('keeps every control and no badge for a connection without either field', async () => {
    const dialog = await openPanel([CONNECTION], SAVED);

    expect(within(dialog).queryByRole('note')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(dialog).getByText('Tool access')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Select files from Google Drive' })).toBeInTheDocument();
    const card = screen.getByRole('article', { hidden: true });
    expect(within(card).getByRole('button', { name: 'Disconnect', hidden: true })).toBeInTheDocument();
    expect(within(card).queryByText('Managed')).not.toBeInTheDocument();
    expect(within(card).queryByText('Shared')).not.toBeInTheDocument();
  });
});

describe('CustomizeView Reconnect', () => {
  it('never opens a new connect flow when the delete fails', async () => {
    vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteDatasource).mockRejectedValueOnce(refusal(403, READ_ONLY_NOTE));
    const onReconnect = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect });

    await reconnect(dialog);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(`Could not disconnect: ${READ_ONLY_NOTE}`));
    expect(deleteDatasource).toHaveBeenCalledExactlyOnceWith('google_drive', 'google_drive-team');
    expect(onReconnect).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    ['without either field', CONNECTION, SAVED],
    ['that is not shared', { ...CONNECTION, managed: false, shared: false }, { ...SAVED, managed: false, shared: false }],
  ])('deletes a connection %s, then opens the connect flow with the spec', async (_, connection, saved) => {
    vi.stubGlobal('alert', vi.fn());
    vi.mocked(deleteDatasource).mockResolvedValueOnce({ ok: true });
    const onReconnect = vi.fn();
    const dialog = await openPanel([connection], saved, { onReconnect });

    const asked = await reconnect(dialog);

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC, {}));
    expect(asked).toContain(PLAIN_RECONNECT);
    expect(deleteDatasource).toHaveBeenCalledExactlyOnceWith('google_drive', 'google_drive-team');
    expect(vi.mocked(deleteDatasource).mock.invocationCallOrder[0])
      .toBeLessThan(onReconnect.mock.invocationCallOrder[0]);
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['the list row', { ...CONNECTION, managed: false, shared: true }, SAVED],
    ['the detail response', CONNECTION, { ...SAVED, managed: false, shared: true }],
  ])("opens the connect flow without deleting the creator's own shared connection when %s marks it shared", async (_, connection, saved) => {
    /* Deleting it first would remove it for everyone it's shared with, and
       cowork-server refuses the new connection under the name the operator
       still shares. */
    vi.stubGlobal('alert', vi.fn());
    const onReconnect = vi.fn();
    const dialog = await openPanel([connection], saved, { onReconnect });

    const asked = await reconnect(dialog);

    /* Shared, so the existing name rides along: the submit updates that entry
       in place instead of saving a second one under a fresh slug. */
    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC, { existingName: 'google_drive-team' }));
    expect(asked).toContain(SHARED_RECONNECT);
    expect(deleteDatasource).not.toHaveBeenCalled();
    expect(host.keychainRevoke).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Nobody lost it, so its card stays.
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it("keeps the creator's own shared connection when the person cancels Reconnect", async () => {
    const onReconnect = vi.fn();
    const dialog = await openPanel([{ ...CONNECTION, managed: false, shared: true }], SAVED, { onReconnect });

    await reconnect(dialog, 'Cancel');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reconnect Google Drive?' })).not.toBeInTheDocument());

    expect(onReconnect).not.toHaveBeenCalled();
    expect(deleteDatasource).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the connect flow when the connection was already removed', async () => {
    vi.stubGlobal('alert', vi.fn());
    /* Someone else removed it first, so the vault no longer lists it and the
       DELETE answers 404. */
    vi.mocked(deleteDatasource).mockImplementationOnce(() => {
      state.connections = [];
      return Promise.reject(refusal(404, 'Connection not found.'));
    });
    const onReconnect = vi.fn();
    const onConnectionsSynced = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect, onConnectionsSynced });

    await reconnect(dialog);

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC, {}));
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(onConnectionsSynced).toHaveBeenLastCalledWith([]);
  });

  it('opens the connect flow when the refresh fails after a successful delete', async () => {
    vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(deleteDatasource).mockImplementationOnce(() => {
      vi.mocked(fetchDatasources).mockRejectedValueOnce(new Error('API /connectors/connections/ returned 504'));
      return Promise.resolve({ ok: true });
    });
    const changed = vi.fn();
    window.addEventListener('anton:connections-changed', changed);
    onTestFinished(() => window.removeEventListener('anton:connections-changed', changed));
    const onReconnect = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect });

    await reconnect(dialog);

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC, {}));
    // Once on mount, once for the refresh that failed.
    expect(fetchDatasources).toHaveBeenCalledTimes(2);
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe('CustomizeView Disconnect', () => {
  it('drops a card whose connection was already removed, without an alert', async () => {
    vi.stubGlobal('alert', vi.fn());
    vi.mocked(deleteDatasource).mockImplementationOnce(() => {
      state.connections = [];
      return Promise.reject(refusal(404, 'Connection not found.'));
    });
    state.connections = [CONNECTION];
    render(<CustomizeView connectors={[CONNECTION]} />);

    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Disconnect' }));
    const confirm = await screen.findByRole('dialog', { name: 'Disconnect google_drive/google_drive-team?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(window.alert).not.toHaveBeenCalled();
  });
});

describe('CustomizeView Reconnect on desktop', () => {
  beforeEach(() => {
    host.isWeb = false;
    host.isElectron = true;
  });

  it.each(['browser_oauth_builtin', 'mcp'])('revokes in main and opens the connect flow for a %s connection', async (method) => {
    vi.stubGlobal('alert', vi.fn());
    host.keychainRevoke.mockImplementationOnce(() => {
      state.connections = [];
      return Promise.resolve({ ok: true });
    });
    const onReconnect = vi.fn();
    const dialog = await openPanel([CONNECTION], { ...SAVED, method }, { onReconnect });

    await reconnect(dialog);

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC, {}));
    expect(host.keychainRevoke).toHaveBeenCalledExactlyOnceWith('google_drive', 'google_drive-team', 'team@example.com');
    expect(deleteDatasource).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
