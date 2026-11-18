// A custom MCP server's detail panel: its own section replaces the access
// mode, and removing it goes through the app's main process, never the
// generic delete, so the login is revoked and the keychain entries go too.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ID = `cm-${'a'.repeat(32)}`;
const CONNECTIONS = [{ engine: 'custom_mcp', name: ID, label: 'Tracker', user_label: null, display_name: null }];

const api = vi.hoisted(() => ({
  deleteDatasource: vi.fn(),
  fetchDatasources: vi.fn(),
}));
vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: '__KEEP__',
  deleteDatasource: api.deleteDatasource,
  fetchConnector: vi.fn(() => Promise.reject(Object.assign(new Error('not found'), { status: 404 }))),
  fetchDatasources: api.fetchDatasources,
  fetchSavedConnection: vi.fn(() => Promise.resolve({ method: 'mcp', fields: {}, secureKeys: [] })),
  patchConnectionAccessMode: vi.fn(),
}));
const bridge = vi.hoisted(() => ({
  customMcpSummary: vi.fn(async () => ({ ok: true, label: 'Tracker', serverUrl: 'https://mcp.example.com/mcp' })),
  customMcpTools: vi.fn(async () => ({ ok: true, tools: [] })),
  customMcpDisconnect: vi.fn(async () => ({ ok: true, revoked: true })),
  keychainRevoke: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(), ...bridge },
}));

import CustomizeView from './CustomizeView';

afterEach(() => { vi.clearAllMocks(); });

async function openPanel() {
  api.fetchDatasources.mockResolvedValue({ connections: CONNECTIONS });
  render(<CustomizeView connectors={CONNECTIONS} />);
  await userEvent.click(screen.getByRole('button', { name: /Manage Tracker/i }));
  await screen.findByText('https://mcp.example.com/mcp');
}

describe('CustomizeView custom MCP connection', () => {
  it('shows the server section instead of the access mode', async () => {
    await openPanel();

    expect(screen.queryByText('Tool access')).toBeNull();
    expect(within(screen.getByRole('dialog')).queryByRole('combobox')).toBeNull();
    expect(screen.getByText('This server lists no tools.')).toBeTruthy();
  });

  it('removes the connection through main, never the generic delete', async () => {
    await openPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Disconnect Tracker?' });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(bridge.customMcpDisconnect).toHaveBeenCalledWith(ID));
    expect(api.deleteDatasource).not.toHaveBeenCalled();
    expect(bridge.keychainRevoke).not.toHaveBeenCalled();
  });
});
