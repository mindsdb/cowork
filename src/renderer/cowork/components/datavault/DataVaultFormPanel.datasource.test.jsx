// A cloud datasource submit goes to the relay, and the connection it answers
// with decides what the user sees.
//
// It must not go down the chat submission stream: the credential belongs to
// auth, and this form is dedicated entry kept out of the conversation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  createDatasourceConnection: vi.fn(),
  discoverPostHogProjects: vi.fn(),
  saveConnector: vi.fn(),
  fetchDatasources: vi.fn(async () => []),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
  submitDataVaultForm: vi.fn(),
}));
// Only the calls this path uses are replaced; everything else, including the
// vault sentinel the form reads, passes through.
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));
vi.mock('../../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { openExternal: vi.fn(), isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null },
}));
vi.mock('../../lib/analytics', () => ({ trackDataSourceConnected: vi.fn() }));

import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, getForm, setForm } from './formStore';

const CID = 'conv-datasource-submit';

const SPEC = {
  form_id: 'postgres-connector',
  title: 'Connect PostgreSQL',
  engine: 'postgres',
  _connector_id: 'postgres',
  _cloud_datasource: true,
  selected_method: 'host-port',
  methods: [{
    id: 'host-port',
    label: 'Host and port',
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, default: 'db.example.com' },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'analytics' },
      { name: 'username', label: 'Username', type: 'text', required: true, default: 'readonly' },
      { name: 'password', label: 'Password', type: 'password', secret: true, required: true, default: 'secret' },
      { name: 'tls_mode', label: 'Certificate trust', type: 'select', required: true, default: 'system',
        options: [{ value: 'system', label: 'Public certificate authorities' }, { value: 'custom_ca', label: 'Custom CA certificate' }] },
    ],
    actions: [{ id: 'submit', label: 'Connect', kind: 'primary' }],
  }],
};

const CONNECTION = {
  id: 7, connector_id: 'postgres', method: 'host-port', name: 'Analytics',
  status: 'pending', credential_version: 1, host_masked: 'db.***.example.com',
  port: 5432, database: 'analytics', username: 'readonly', tls_mode: 'system',
};

async function submitTheForm() {
  render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);
  const label = await screen.findByLabelText(/^Label$/i);
  await userEvent.type(label, 'Analytics');
  await userEvent.click(screen.getByRole('button', { name: /connect/i }));
}

beforeEach(() => {
  setForm(CID, { ...SPEC });
  api.createDatasourceConnection.mockResolvedValue(CONNECTION);
});

afterEach(() => {
  clearForm(CID);
  vi.clearAllMocks();
});

describe('submitting a cloud datasource form', () => {
  it('posts the structured body to the relay and not to the chat stream', async () => {
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} onContinue={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText(/^Label$/i), 'Analytics');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(api.createDatasourceConnection).toHaveBeenCalledTimes(1));
    expect(api.createDatasourceConnection.mock.calls[0][0]).toMatchObject({
      connector_id: 'postgres',
      method: 'host-port',
      name: 'Analytics',
      input_mode: 'structured',
      host: 'db.example.com',
      database: 'analytics',
      username: 'readonly',
      password: 'secret',
      tls: { mode: 'system', ca_pem: null },
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(api.submitDataVaultForm).not.toHaveBeenCalled();
  });

  it('waits in a pending state rather than claiming success', async () => {
    await submitTheForm();

    await waitFor(() => expect(getForm(CID)?._datasource_pending).toBe(true));
    expect(getForm(CID)?._is_success).toBeFalsy();
    expect(getForm(CID)?.form_error).toBeFalsy();
  });

  it('reports a verified connection as connected', async () => {
    api.createDatasourceConnection.mockResolvedValue({ ...CONNECTION, status: 'verified' });
    await submitTheForm();

    await waitFor(() => expect(getForm(CID)?._is_success).toBe(true));
  });

  it('shows the reason auth recorded when the check failed', async () => {
    api.createDatasourceConnection.mockResolvedValue({
      ...CONNECTION, status: 'failed', validation_error: 'password authentication failed',
    });
    await submitTheForm();

    await waitFor(() => expect(getForm(CID)?.form_error).toBe('password authentication failed'));
    expect(getForm(CID)?._is_success).toBeFalsy();
  });

  it('shows the relay refusal as its own message', async () => {
    const refusal = new Error('host must be reachable from the internet');
    refusal.code = 'invalid_connection';
    refusal.status = 400;
    api.createDatasourceConnection.mockRejectedValue(refusal);
    await submitTheForm();

    expect(await screen.findByText('host must be reachable from the internet')).toBeInTheDocument();
  });
});
