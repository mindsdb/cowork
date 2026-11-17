// A member's custom API connections on the connections page: listed from
// their own relay in cloud, removed through it, and never asked for on desktop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setOrgMode } from '../../lib/orgMode';

const api = vi.hoisted(() => ({
  listCustomConnections: vi.fn(),
  deleteCustomConnection: vi.fn(),
  listDatasourceConnections: vi.fn(async () => []),
  deleteDatasourceConnection: vi.fn(),
  deleteDatasource: vi.fn(),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchConnector: vi.fn(),
  fetchSavedConnection: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));
vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { isElectron: false, isWeb: true, getApiOrigin: () => 'http://x', getAccessToken: async () => null, openExternal: vi.fn() },
}));

import CustomizeView from './CustomizeView';

const ACME = {
  id: 7, connector_id: 'acme_crm', name: 'Acme', secure_keys: ['api_key'], status: 'verified',
  credential_version: 1, created_at: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T10:00:00Z', template_missing: false,
};

async function acmeCard() {
  return (await screen.findAllByText('Acme', { exact: false }))[0].closest('article');
}

beforeEach(() => {
  setOrgMode(true);
  api.listCustomConnections.mockResolvedValue([ACME]);
  api.deleteCustomConnection.mockResolvedValue({ ok: true });
});

afterEach(() => {
  setOrgMode(false);
  vi.clearAllMocks();
});

describe('custom connections on the connections page', () => {
  it('lists them as connected custom connectors', async () => {
    render(<CustomizeView connectors={[]} />);

    const card = await acmeCard();
    expect(within(card).getByText('Custom')).toBeInTheDocument();
    expect(within(card).getByText('Connected')).toBeInTheDocument();
  });

  it('removes one through its own relay and drops the card', async () => {
    render(<CustomizeView connectors={[]} />);
    const card = await acmeCard();
    api.listCustomConnections.mockResolvedValue([]);

    await userEvent.click(within(card).getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryAllByText('Acme', { exact: false })).toHaveLength(0));
    expect(api.deleteCustomConnection).toHaveBeenCalledExactlyOnceWith(7);
    expect(api.deleteDatasource).not.toHaveBeenCalled();
    expect(api.deleteDatasourceConnection).not.toHaveBeenCalled();
  });

  it('keeps the card and says why when the removal fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.deleteCustomConnection.mockRejectedValueOnce(new Error('auth refused'));
    render(<CustomizeView connectors={[]} />);
    const card = await acmeCard();

    await userEvent.click(within(card).getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByRole('dialog', { name: 'Could not disconnect' })).toHaveTextContent('auth refused');
  });

  it('does not ask the relay on desktop', async () => {
    setOrgMode(false);
    render(<CustomizeView connectors={[]} />);

    await waitFor(() => expect(api.fetchDatasources).toHaveBeenCalled());
    expect(api.listCustomConnections).not.toHaveBeenCalled();
  });
});
