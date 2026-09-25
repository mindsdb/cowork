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
  editDatasourceConnection: vi.fn(),
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
import { toCloudSpec } from '../../lib/cloudConnectorSpec';

const CID = 'conv-datasource-submit';
const TYPED_SECRET = 'typed-not-the-default';

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
        options: [
          { value: 'system', label: 'Public certificate authorities' },
          { value: 'custom_ca', label: 'A CA certificate I provide' },
          { value: 'encrypted', label: 'Encrypt, but do not check the certificate' },
          { value: 'disabled', label: 'No encryption' },
        ] },
    ],
    actions: [{ id: 'submit', label: 'Connect', kind: 'primary' }],
  }],
};

const CONNECTION = {
  id: 7, connector_id: 'postgres', method: 'host-port', name: 'Analytics',
  status: 'pending', credential_version: 1, revision: 1, host_masked: 'db.***.example.com',
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

describe('a capture the gateway refused', () => {
  it('names what to change and turns the next submit into an edit', async () => {
    api.createDatasourceConnection.mockResolvedValue({
      ...CONNECTION,
      status: 'failed',
      validation_error: 'validation failed',
      validation_code: 'tls_failed',
      credential_version: 2,
      revision: 6,
    });
    api.editDatasourceConnection.mockResolvedValue({ ...CONNECTION, status: 'verified', credential_version: 2 });

    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);
    const password = await screen.findByLabelText(/^Password$/i);
    await userEvent.clear(password);
    await userEvent.type(password, TYPED_SECRET);
    await userEvent.type(await screen.findByLabelText(/^Label$/i), 'Analytics');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    // The reason auth stores says nothing actionable; the gateway's code does.
    const shown = await screen.findByText(/certificate could not be verified/i);
    expect(shown.textContent).toMatch(/signed by a public authority/);
    // And only the gateway's: auth's fixed "validation failed" in front of it
    // reads like a second, emptier sentence.
    expect(shown.textContent).not.toMatch(/validation failed/i);

    // Back to the form, where the trust choice can be changed, and submitting
    // again edits the connection that already exists rather than creating a
    // second one, which auth would refuse on the name.
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    // The shared retry patch drops the method's own action label, so the
    // primary button reads as the default here. Pre-existing and cosmetic:
    // the action id and kind are unchanged, which is what submitting uses.
    // Returning to the form starts from an empty one, which the card says, so
    // the password goes in again along with the trust choice the hint named.
    const reopened = await screen.findByLabelText(/^Password$/i);
    await userEvent.clear(reopened);
    await userEvent.type(reopened, TYPED_SECRET);
    await userEvent.click(await screen.findByRole('combobox', { name: /certificate trust/i }));
    await userEvent.click(await screen.findByRole('option', { name: /do not check the certificate/i }));
    await userEvent.click(await screen.findByRole('button', { name: /submit|connect/i }));

    await waitFor(() => expect(api.editDatasourceConnection).toHaveBeenCalledTimes(1));
    const [id, body, revision] = api.editDatasourceConnection.mock.calls[0];
    expect(id).toBe(7);
    // The failed capture's revision, never its credential version.
    expect(revision).toBe(6);
    // Every other field in this fixture defaults to what a user would type, so
    // the password is the only one that shows what the second submit carried.
    expect(body.password).toBe(TYPED_SECRET);
    expect(body.tls).toEqual({ mode: 'encrypted', ca_pem: null });
    expect(api.createDatasourceConnection).toHaveBeenCalledTimes(1);
  });

  it('says only what the server said when the code carries no advice', async () => {
    api.createDatasourceConnection.mockResolvedValue({
      ...CONNECTION,
      status: 'failed',
      validation_error: 'validation failed',
      validation_code: 'something_new',
    });

    await submitTheForm();

    expect(await screen.findByText(/validation failed/i)).toBeTruthy();
    expect(screen.queryByText(/Certificate trust/)).toBeNull();
  });
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

  it('shows a waiting state rather than claiming success, and takes the fields away with it', async () => {
    await submitTheForm();

    // The rendered surface, not a flag: the typed password must leave the page
    // and a second submit must not be possible.
    expect(await screen.findByText(/checking the connection/i)).toBeInTheDocument();
    expect(screen.getByText(/result shows up on Connect Apps and Data/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByRole('button', { name: /^connect$/i })).toBeNull();
  });

  it('reports a verified connection as connected', async () => {
    api.createDatasourceConnection.mockResolvedValue({ ...CONNECTION, status: 'verified' });
    await submitTheForm();

    expect(await screen.findByText(/^Connected$/i)).toBeInTheDocument();
  });

  it('shows the reason auth recorded when the check failed', async () => {
    api.createDatasourceConnection.mockResolvedValue({
      ...CONNECTION, status: 'failed', validation_error: 'password authentication failed',
    });
    await submitTheForm();

    expect(await screen.findByText('password authentication failed')).toBeInTheDocument();
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

describe('editing an existing connection', () => {
  const EDIT_SPEC = {
    ...SPEC,
    _datasource_edit: { id: 7, expectedRevision: 6 },
    name: 'Analytics',
    user_label: 'Analytics',
  };

  it('patches the connection it was opened against, with the revision it saw', async () => {
    setForm(CID, { ...EDIT_SPEC });
    api.editDatasourceConnection.mockResolvedValue({ ...CONNECTION, credential_version: 4 });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /connect/i }));

    await waitFor(() => expect(api.editDatasourceConnection).toHaveBeenCalledTimes(1));
    const [id, payload, expectedRevision] = api.editDatasourceConnection.mock.calls[0];
    expect(id).toBe(7);
    expect(expectedRevision).toBe(6);
    expect(payload.password).toBe('secret');
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
  });

  it('sends the label the user edited, which is how a connection is renamed', async () => {
    setForm(CID, { ...EDIT_SPEC });
    api.editDatasourceConnection.mockResolvedValue({ ...CONNECTION, name: 'Warehouse', credential_version: 4 });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);
    const label = await screen.findByLabelText(/^Label$/i);
    await userEvent.clear(label);
    await userEvent.type(label, 'Warehouse');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(api.editDatasourceConnection).toHaveBeenCalledTimes(1));
    const [, payload] = api.editDatasourceConnection.mock.calls[0];
    expect(payload.name).toBe('Warehouse');
  });

  it('says what a version conflict means instead of showing the raw refusal', async () => {
    setForm(CID, { ...EDIT_SPEC });
    const conflict = new Error('stale version');
    conflict.code = 'stale_version';
    conflict.status = 409;
    api.editDatasourceConnection.mockRejectedValue(conflict);
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /connect/i }));

    expect(await screen.findByText(/changed since you opened it/i)).toBeInTheDocument();
  });
});

// The spec the server actually ships for a cloud database: one boolean asking
// whether to verify the certificate, and no tls_mode field to fall back on.
// Built through toCloudSpec so the prefill under test is the real one.
describe('re-saving a connection that was stored verified', () => {
  const CLOUD_SPEC = {
    form_id: 'postgres-connector',
    title: 'Connect PostgreSQL',
    engine: 'postgres',
    _connector_id: 'postgres',
    selected_method: 'host-port',
    methods: [{
      id: 'host-port',
      label: 'Host and port',
      cloud: {
        available: true,
        description: 'A database reachable from the internet.',
        fields: [
          { name: 'host', label: 'Host', type: 'text', required: true },
          { name: 'port', label: 'Port', type: 'text', default: '5432' },
          { name: 'database', label: 'Database', type: 'text', required: true },
          { name: 'username', label: 'Username', type: 'text', required: true },
          { name: 'password', label: 'Password', type: 'password', secret: true, required: true },
          { name: 'tls_verify', label: 'Verify the certificate', type: 'boolean' },
        ],
      },
      actions: [{ id: 'submit', label: 'Connect', kind: 'primary' }],
    }],
  };

  const VERIFIED = {
    datasourceId: 7,
    revision: 6,
    name: 'Analytics',
    hostMasked: 'db.example.com',
    port: 5432,
    database: 'analytics',
    username: 'readonly',
    tlsMode: 'system',
  };

  it('keeps the verification the user can see on the box', async () => {
    setForm(CID, toCloudSpec(CLOUD_SPEC, VERIFIED));
    api.editDatasourceConnection.mockResolvedValue({ ...CONNECTION, status: 'verified', credential_version: 4 });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);

    // The box reports the stored connection as verified before anything is
    // touched; the payload below has to agree with it.
    expect(await screen.findByRole('checkbox', { name: /verify the certificate/i })).toBeChecked();

    // Auth holds the password, so an edit always retypes it. Nothing else is
    // touched, which is the path that dropped the mode.
    await userEvent.type(await screen.findByLabelText(/^Password$/i), TYPED_SECRET);
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(api.editDatasourceConnection).toHaveBeenCalledTimes(1));
    const [, payload] = api.editDatasourceConnection.mock.calls[0];
    expect(payload.tls).toEqual({ mode: 'system', ca_pem: null });
  });
});
