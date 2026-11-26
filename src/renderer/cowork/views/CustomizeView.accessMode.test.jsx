// ENG-487 — HubSpot's MCP connector is the first with an editable-after-
// connect access setting. No existing connector has this, so this is new
// UI, not a widened existing check (unlike DataVaultFormPanel's method
// check). Follows CustomizeView.identity.test.jsx's mocking convention.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  // method is top-level here, not nested under fields — the real local-mode
  // detail endpoint pops _method out of `fields` and promotes it
  // (ConnectionDetailResponse.method, connections.py). Nesting it under
  // `fields` instead let a real bug (CustomizeView.jsx reading
  // vaultFields._method, which is never actually populated) pass unnoticed.
  fetchSavedConnection: vi.fn(() => Promise.resolve({
    method: 'mcp',
    fields: { _access_mode: 'read', account_email: 'acme.hubspot' },
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

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Read and write' }));

    await waitFor(() => expect(patchConnectionAccessModeMock).toHaveBeenCalledWith('hubspot', 'acme-hubspot', 'write'));
  });

  it('opens the same details panel from the tile\'s settings button', async () => {
    render(<CustomizeView connectors={CONNECTIONS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings for HubSpot: acme.hubspot' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Tool access')).toBeInTheDocument());
    expect(within(dialog).getByText('acme-hubspot')).toBeInTheDocument();
  });

  it('updates the tile\'s access label when the mode changes in the panel', async () => {
    const listed = [{ ...CONNECTIONS[0], method: 'mcp', access_mode: 'read' }];
    const { fetchDatasources } = await import('../api');
    vi.mocked(fetchDatasources).mockResolvedValueOnce({ connections: listed });
    patchConnectionAccessModeMock.mockResolvedValueOnce({ ok: true, access_mode: 'none' });
    const onConnectionsSynced = vi.fn();
    render(<CustomizeView connectors={listed} onConnectionsSynced={onConnectionsSynced} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByText('Read only')).toBeInTheDocument();

    await userEvent.click(within(tile).getByRole('button', { name: 'Settings for HubSpot: acme.hubspot' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Tool access')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'No tool access' }));

    await waitFor(() => expect(within(tile).getByText('No tool access')).toBeInTheDocument());
    expect(within(tile).queryByText('Read only')).not.toBeInTheDocument();
    expect(onConnectionsSynced).toHaveBeenLastCalledWith([{ ...listed[0], access_mode: 'none' }]);
  });

  it('leaves the tile\'s access label alone when the change fails', async () => {
    const listed = [{ ...CONNECTIONS[0], method: 'mcp', access_mode: 'read' }];
    const { fetchDatasources } = await import('../api');
    vi.mocked(fetchDatasources).mockResolvedValueOnce({ connections: listed });
    patchConnectionAccessModeMock.mockRejectedValueOnce(new Error('Could not change tool access.'));
    render(<CustomizeView connectors={listed} />);
    const tile = screen.getByRole('article');

    await userEvent.click(within(tile).getByRole('button', { name: 'Settings for HubSpot: acme.hubspot' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Tool access')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Read and write' }));

    await waitFor(() => expect(within(dialog).getByText('Could not change tool access.')).toBeInTheDocument());
    expect(within(tile).getByText('Read only')).toBeInTheDocument();
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
