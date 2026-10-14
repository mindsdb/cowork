// A Reconnect whose delete fails never opens a new connect flow. Follows
// CustomizeView.identity.test.jsx's mocking convention, on the web host.

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const REFUSAL = 'Connection is unavailable';

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

async function openPanel(connections, saved, props = {}) {
  state.connections = connections;
  state.saved = saved;
  render(<CustomizeView connectors={connections} {...props} />);
  await userEvent.click(screen.getByRole('button', { name: /Manage Google Drive/ }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument());
  return dialog;
}

describe('CustomizeView Reconnect', () => {
  it('never opens a new connect flow when the delete fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteDatasource).mockRejectedValueOnce(new Error(REFUSAL));
    const onReconnect = vi.fn();
    const dialog = await openPanel([CONNECTION], SAVED, { onReconnect });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(`Could not disconnect: ${REFUSAL}`));
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
});
