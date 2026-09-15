// ENG-487 — HubSpot's MCP connector is the first with an editable-after-
// connect access setting. No existing connector has this, so this is new
// UI, not a widened existing check (unlike DataVaultFormPanel's method
// check). Follows CustomizeView.identity.test.jsx's mocking convention.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const CONNECTIONS = [
  { engine: 'hubspot', name: 'acme-hubspot', label: 'HubSpot', user_label: null, display_name: 'acme.hubspot' },
];

const HUBSPOT_SPEC = {
  label: 'HubSpot',
  form: { methods: [{ id: 'mcp', label: 'In-Browser Connect', fields: [] }] },
};

const patchConnectionAccessModeMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: '__KEEP__',
  deleteDatasource: vi.fn(),
  fetchConnector: vi.fn(() => Promise.resolve(HUBSPOT_SPEC)),
  fetchDatasources: vi.fn(() => Promise.resolve({ connections: CONNECTIONS })),
  fetchSavedConnection: vi.fn(() => Promise.resolve({
    fields: { _method: 'mcp', _access_mode: 'read', account_email: 'acme.hubspot' },
    secureKeys: [],
  })),
  patchConnectionAccessMode: patchConnectionAccessModeMock,
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(), keychainRevoke: vi.fn() },
}));

import CustomizeView from './CustomizeView';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('CustomizeView — HubSpot "edit access" affordance', () => {
  it('shows a tool-access control seeded from the stored access mode', async () => {
    render(<CustomizeView connectors={CONNECTIONS} />);
    await userEvent.click(screen.getByRole('button', { name: /Manage HubSpot/i }));

    await waitFor(() => expect(screen.getByText('Tool access')).toBeInTheDocument());
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  it('calls patchConnectionAccessMode when the user changes it', async () => {
    patchConnectionAccessModeMock.mockResolvedValueOnce({ ok: true, access_mode: 'write' });
    render(<CustomizeView connectors={CONNECTIONS} />);
    await userEvent.click(screen.getByRole('button', { name: /Manage HubSpot/i }));
    await waitFor(() => expect(screen.getByText('Tool access')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Read and write' }));

    await waitFor(() => expect(patchConnectionAccessModeMock).toHaveBeenCalledWith('hubspot', 'acme-hubspot', 'write'));
  });

  it('does not render a tool-access control for a non-MCP connection', async () => {
    const { fetchSavedConnection } = await import('../api');
    vi.mocked(fetchSavedConnection).mockResolvedValueOnce({
      fields: { account_email: 'a@b.com' }, secureKeys: [],
    });
    render(<CustomizeView connectors={[{ engine: 'linear', name: 'linear-1', label: 'Linear' }]} />);
    await userEvent.click(screen.getByRole('button', { name: /Manage Linear/i }));

    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.queryByText('Tool access')).not.toBeInTheDocument();
  });
});
