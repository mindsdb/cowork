/* A SharePoint connection's key and sites are changed in place through the
   SharePoint edit form, never by deleting the connection and connecting it
   again: the new key is checked before it replaces the stored one.
   Follows CustomizeView.managed.test.jsx's mocking convention. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const CONNECTION = {
  engine: 'sharepoint', name: 'corp', label: 'SharePoint', user_label: null, display_name: null,
};
const SPEC = { label: 'SharePoint', form: { methods: [{ id: 'app-key', label: 'App key', fields: [] }] } };
const SAVED = {
  method: null,
  user_label: null,
  fields: {
    tenant_id: 'contoso.onmicrosoft.com',
    client_id: '11111111-2222-3333-4444-555555555555',
    client_secret: 'ANTON_VAULT_KEEP',
    site_urls: 'https://contoso.sharepoint.com/sites/team',
  },
  secureKeys: ['client_secret'],
};

const state = vi.hoisted(() => ({ connections: [], saved: null }));
const host = vi.hoisted(() => ({
  isWeb: true, isElectron: false, isMac: () => false,
  openExternal: vi.fn(), keychainRevoke: vi.fn(), pickDriveFiles: vi.fn(), cancelDrivePicker: vi.fn(),
}));

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: 'ANTON_VAULT_KEEP',
  createSharePointConnection: vi.fn(),
  deleteDatasource: vi.fn(),
  editSharePointConnection: vi.fn(),
  fetchConnector: vi.fn(),
  fetchDatasources: vi.fn(),
  fetchSavedConnection: vi.fn(),
  patchConnectionAccessMode: vi.fn(),
}));
vi.mock('../../platform/host', () => ({ host }));

import CustomizeView from './CustomizeView';
import { deleteDatasource, fetchConnector, fetchDatasources, fetchSavedConnection } from '../api';

beforeEach(() => {
  vi.mocked(deleteDatasource).mockReset();
  vi.mocked(fetchConnector).mockReset().mockResolvedValue(SPEC);
  vi.mocked(fetchDatasources).mockReset().mockImplementation(() => Promise.resolve({ connections: state.connections }));
  vi.mocked(fetchSavedConnection).mockReset().mockImplementation(() => Promise.resolve(state.saved));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openPanel(connection, saved) {
  state.connections = [connection];
  state.saved = saved;
  render(<CustomizeView connectors={[connection]} />);
  await userEvent.click(screen.getByRole('button', { name: /^(Manage|View) SharePoint/ }));
  const dialog = screen.getAllByRole('dialog')[0];
  await waitFor(() => expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument());
  return dialog;
}

describe('CustomizeView SharePoint connections', () => {
  it('opens the SharePoint edit form from "Edit key and sites"', async () => {
    const dialog = await openPanel(CONNECTION, SAVED);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit key and sites' }));

    expect(await screen.findByRole('dialog', { name: 'Edit SharePoint connection' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/tenant/i)).toHaveValue('contoso.onmicrosoft.com'));
    expect(fetchSavedConnection).toHaveBeenCalledWith('sharepoint', 'corp');
  });

  it('Reconnect edits in place without deleting the connection', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const dialog = await openPanel(CONNECTION, SAVED);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconnect' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('stays as it is until the new key is checked');
    expect(confirm.mock.calls[0][0]).not.toContain('removed');
    expect(await screen.findByRole('dialog', { name: 'Edit SharePoint connection' })).toBeInTheDocument();
    expect(deleteDatasource).not.toHaveBeenCalled();
  });

  it('has no "Edit key and sites" or Reconnect on a managed connection', async () => {
    const dialog = await openPanel({ ...CONNECTION, managed: true }, { ...SAVED, managed: true });

    expect(within(dialog).queryByRole('button', { name: 'Edit key and sites' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('offers "Edit key and sites" even when the server has no SharePoint spec', async () => {
    vi.mocked(fetchConnector).mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const dialog = await openPanel(CONNECTION, SAVED);

    expect(within(dialog).getByRole('button', { name: 'Edit key and sites' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });
});
