// The pending state's buttons route; they never submit.
//
// A cloud database is stored before it is known to work, so the form that
// captured it ends on a pending card with Close and View connections. Both are
// terminal for this panel: the credential is already in auth, and there is
// nothing left to send. Treating them as ordinary form actions sent a chat
// message on one and attempted a second create with an empty body on the
// other.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  createDatasourceConnection: vi.fn(),
  editDatasourceConnection: vi.fn(),
  discoverPostHogProjects: vi.fn(),
  saveConnector: vi.fn(),
  fetchDatasources: vi.fn(async () => []),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
  submitDataVaultForm: vi.fn(),
}));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));
vi.mock('../../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { openExternal: vi.fn(), isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null },
}));
vi.mock('../../lib/analytics', () => ({ trackDataSourceConnected: vi.fn() }));

import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';

const CID = 'conv-datasource-pending';

const PENDING_SPEC = {
  form_id: 'postgres-connector',
  title: 'Checking the connection',
  subtitle: 'Your credentials are stored encrypted.',
  engine: 'postgres',
  _connector_id: 'postgres',
  _cloud_datasource: true,
  _datasource_pending: true,
  selected_method: 'host-port',
  methods: [{ id: 'host-port', label: 'Host and port', fields: [] }],
};

beforeEach(() => {
  setForm(CID, { ...PENDING_SPEC });
});

afterEach(() => {
  clearForm(CID);
  vi.clearAllMocks();
});

describe('the pending card', () => {
  it('closes without sending anything to the chat or the relay', async () => {
    const onContinue = vi.fn();
    const onClose = vi.fn();
    render(
      <DataVaultFormPanel
        conversationId={CID}
        onSubmit={vi.fn()}
        onContinue={onContinue}
        onNavigateToConnectors={vi.fn()}
        onClose={onClose}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /^close$/i }));

    // The host owns dismissal, so a panel with onClose hands it over rather
    // than clearing the store itself.
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(CID));
    expect(onContinue).not.toHaveBeenCalled();
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
    expect(api.submitDataVaultForm).not.toHaveBeenCalled();
  });

  it('routes to the connections page instead of capturing a second time', async () => {
    const onNavigateToConnectors = vi.fn();
    const onClose = vi.fn();
    render(
      <DataVaultFormPanel
        conversationId={CID}
        onSubmit={vi.fn()}
        onContinue={vi.fn()}
        onNavigateToConnectors={onNavigateToConnectors}
        onClose={onClose}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /view connections/i }));

    await waitFor(() => expect(onNavigateToConnectors).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledWith(CID);
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
    expect(api.editDatasourceConnection).not.toHaveBeenCalled();
  });
});
