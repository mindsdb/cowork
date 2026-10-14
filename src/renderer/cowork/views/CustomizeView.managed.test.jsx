// Operator-managed connections are read-only on the Connections page, and a
// Reconnect whose delete fails never opens a new connect flow, while one whose
// connection is already gone does. Follows CustomizeView.identity.test.jsx's
// mocking convention, on the web host the self-hosted stack serves.

import { beforeEach, afterEach, describe, it, expect, onTestFinished, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const OPERATOR_NOTE = "This connection is provided by your operator and can't be changed here.";

// google_drive plus an MCP method so one panel would show every control the
// managed state hides: the Drive picker, the access-mode select, Reconnect
// and Remove.
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

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: '__KEEP__',
  deleteDatasource: vi.fn(),
  fetchConnector: vi.fn(),
  fetchDatasources: vi.fn(),
  fetchSavedConnection: vi.fn(),
  patchConnectionAccessMode: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: true, isElectron: false, isMac: () => false,
    openExternal: vi.fn(), keychainRevoke: vi.fn(), pickDriveFiles: vi.fn(), cancelDrivePicker: vi.fn(),
  },
}));

import CustomizeView from './CustomizeView';
import { deleteDatasource, fetchConnector, fetchDatasources, fetchSavedConnection } from '../api';

beforeEach(() => {
  vi.mocked(deleteDatasource).mockReset();
  vi.mocked(fetchConnector).mockReset().mockImplementation(() => Promise.resolve(SPEC));
  // The view refetches on mount and replaces its list, so this must return the
  // same fixtures the test renders with.
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
  await userEvent.click(screen.getByRole('button', { name: /Manage Google Drive/ }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument());
  return dialog;
}

describe('CustomizeView operator-managed connections', () => {
  it.each([
    ['the list row', { ...CONNECTION, managed: true }, SAVED],
    ['the detail response', CONNECTION, { ...SAVED, managed: true }],
  ])('shows the panel read-only when %s marks the connection managed', async (_, connection, saved) => {
    const dialog = await openPanel([connection], saved);

    expect(within(dialog).getByRole('note')).toHaveTextContent(OPERATOR_NOTE);
    expect(within(dialog).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Tool access')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Select files from Google Drive' })).not.toBeInTheDocument();
    // What the connection is stays visible.
    expect(within(dialog).getByText('Engine')).toBeInTheDocument();
  });

  it('shows the Managed badge and no Disconnect on the managed card', () => {
    const managed = { ...CONNECTION, managed: true };
    state.connections = [managed];
    render(<CustomizeView connectors={[managed]} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText('Managed')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('keeps every control for a connection without the managed field', async () => {
    const dialog = await openPanel([CONNECTION], SAVED);

    expect(within(dialog).queryByRole('note')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Remove/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Tool access')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Select files from Google Drive' })).toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
});

describe('CustomizeView Reconnect', () => {
  it('never opens a new connect flow when the delete fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteDatasource).mockRejectedValueOnce(refusal(403, OPERATOR_NOTE));
    const onReconnect = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(`Could not disconnect: ${OPERATOR_NOTE}`));
    expect(deleteDatasource).toHaveBeenCalledExactlyOnceWith('google_drive', 'google_drive-team');
    expect(onReconnect).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the connect flow with the spec once the delete succeeds', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    vi.mocked(deleteDatasource).mockResolvedValueOnce({ ok: true });
    const onReconnect = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC));
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the connect flow when the connection was already removed', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    // Someone else removed it first, so the vault no longer lists it and the
    // DELETE answers 404.
    vi.mocked(deleteDatasource).mockImplementationOnce(() => {
      state.connections = [];
      return Promise.reject(refusal(404, 'Connection not found.'));
    });
    const onReconnect = vi.fn();
    const onConnectionsSynced = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect, onConnectionsSynced });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC));
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(onConnectionsSynced).toHaveBeenLastCalledWith([]);
  });

  it('opens the connect flow when the refresh fails after a successful delete', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
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

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(onReconnect).toHaveBeenCalledExactlyOnceWith(SPEC));
    // Once on mount, once for the refresh that failed.
    expect(fetchDatasources).toHaveBeenCalledTimes(2);
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe('CustomizeView Disconnect', () => {
  it('drops a card whose connection was already removed, without an alert', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    vi.mocked(deleteDatasource).mockImplementationOnce(() => {
      state.connections = [];
      return Promise.reject(refusal(404, 'Connection not found.'));
    });
    state.connections = [CONNECTION];
    render(<CustomizeView connectors={[CONNECTION]} />);

    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(window.alert).not.toHaveBeenCalled();
  });
});
