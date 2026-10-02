// Cloud database connections on the connections page.
//
// They share the page and its card with the OAuth connections, and differ in
// two ways that matter: they are fetched and refreshed on their own (the
// OAuth array is replaced wholesale on every sync, which would drop them),
// and every route they use is the relay's, not the OAuth vault's.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setOrgMode } from '../../lib/orgMode';

const api = vi.hoisted(() => ({
  listDatasourceConnections: vi.fn(),
  deleteDatasourceConnection: vi.fn(),
  retryDatasourceValidation: vi.fn(),
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

const POSTGRES = {
  id: 7, connector_id: 'postgres', method: 'host-port', name: 'Analytics',
  status: 'verified', credential_version: 3, revision: 6, host_masked: 'db.***.example.com',
  port: 5432, database: 'analytics', username: 'readonly', tls_mode: 'system',
};
const FAILED = { ...POSTGRES, id: 8, name: 'Reporting', status: 'failed', validation_error: 'password authentication failed' };

beforeEach(() => {
  setOrgMode(true);
  api.listDatasourceConnections.mockResolvedValue([POSTGRES]);
});

afterEach(() => {
  setOrgMode(false);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('the connections page in cloud', () => {
  it('lists database connections beside the OAuth ones, in one grid', async () => {
    // The page refetches the OAuth list on mount, so that is where it comes from.
    api.fetchDatasources.mockResolvedValue({ connections: [{ engine: 'gmail', name: 'work', status: 'connected' }] });
    render(<CustomizeView connectors={[]} />);

    expect(await screen.findByText('Analytics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Gmail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Postgres/i })).toBeInTheDocument();
  });

  it('shows one card per connection, with the props App really passes', async () => {
    // App gives this page the OAuth list; the page fetches databases itself.
    // Handing it both would render every database twice.
    api.fetchDatasources.mockResolvedValue({ connections: [{ engine: 'gmail', name: 'work', status: 'connected' }] });
    render(<CustomizeView connectors={[{ engine: 'gmail', name: 'work', status: 'connected' }]} />);

    expect(await screen.findAllByRole('button', { name: /Manage Postgres: Analytics/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Manage Gmail/i })).toHaveLength(1);
  });

  it('does not ask the relay on desktop, where its routes do not exist', async () => {
    setOrgMode(false);
    render(<CustomizeView connectors={[]} />);

    await waitFor(() => expect(api.fetchDatasources).toHaveBeenCalled());
    expect(api.listDatasourceConnections).not.toHaveBeenCalled();
  });

  it('removes a database connection through the relay, never the OAuth route', async () => {
    render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Analytics/i }));

    const panel = await screen.findByRole('dialog', { name: /Analytics connection/i });
    await userEvent.click(within(panel).getByRole('button', { name: /^remove$/i }));

    // The removal is behind a confirmation, so nothing is deleted on the click
    // that opens it.
    const confirm = await screen.findByRole('dialog', { name: /Remove Analytics\?/i });
    expect(api.deleteDatasourceConnection).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(api.deleteDatasourceConnection).toHaveBeenCalledWith(7));
    expect(api.deleteDatasource).not.toHaveBeenCalled();
  });

  it('keeps the connection when the confirmation is cancelled', async () => {
    render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Analytics/i }));

    const panel = await screen.findByRole('dialog', { name: /Analytics connection/i });
    await userEvent.click(within(panel).getByRole('button', { name: /^remove$/i }));

    const confirm = await screen.findByRole('dialog', { name: /Remove Analytics\?/i });
    await userEvent.click(within(confirm).getByRole('button', { name: /cancel/i }));

    expect(api.deleteDatasourceConnection).not.toHaveBeenCalled();
  });

  it('offers a retry only for a failed check, and says why it failed', async () => {
    api.listDatasourceConnections.mockResolvedValue([FAILED]);
    render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Reporting/i }));

    const panel = await screen.findByRole('dialog', { name: /Reporting connection/i });
    expect(within(panel).getByText('password authentication failed')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(api.retryDatasourceValidation).toHaveBeenCalledWith(8));
  });

  it('shows no retry for a healthy connection', async () => {
    render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Analytics/i }));

    const panel = await screen.findByRole('dialog', { name: /Analytics connection/i });
    expect(within(panel).queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('shows the schema a connection reads, and no row when it reads any', async () => {
    api.listDatasourceConnections.mockResolvedValue([{ ...POSTGRES, schema: 'sales_ops' }]);
    const named = render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Analytics/i }));

    const panel = await screen.findByRole('dialog', { name: /Analytics connection/i });
    expect(within(panel).getByText('Schema')).toBeInTheDocument();
    expect(within(panel).getByText('sales_ops')).toBeInTheDocument();
    named.unmount();

    api.listDatasourceConnections.mockResolvedValue([POSTGRES]);
    render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Analytics/i }));

    const plain = await screen.findByRole('dialog', { name: /Analytics connection/i });
    expect(within(plain).queryByText('Schema')).toBeNull();
  });

  it('never shows a credential, only what the relay returns', async () => {
    render(<CustomizeView connectors={[]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage Postgres: Analytics/i }));

    const panel = await screen.findByRole('dialog', { name: /Analytics connection/i });
    expect(within(panel).getByText('db.***.example.com')).toBeInTheDocument();
    expect(within(panel).getByText(/never shown again/i)).toBeInTheDocument();
  });
});
