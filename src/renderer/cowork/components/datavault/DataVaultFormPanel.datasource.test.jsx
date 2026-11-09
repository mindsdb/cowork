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

import { DataVaultForm } from './DataVaultForm';
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
  status: 'pending', credential_version: 1, revision: 4, host_masked: 'db.***.example.com',
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

// The relay saves the Label as the connection's name and refuses an empty
// one, so the form has to ask for it the way it asks for every other field.
describe('the Label on a cloud database form', () => {
  // Shaped like the server's MySQL spec and passed through toCloudSpec, so
  // the flag under test is set the way the app sets it.
  const MYSQL_SPEC = toCloudSpec({
    form_id: 'mysql-connector',
    title: 'Connect MySQL',
    engine: 'mysql',
    _connector_id: 'mysql',
    selected_method: 'host-port',
    methods: [{
      id: 'host-port',
      label: 'Host and port',
      cloud: {
        available: true,
        fields: [
          { name: 'host', label: 'Host', type: 'text', required: true, default: 'db.example.com' },
          { name: 'port', label: 'Port', type: 'text', required: true, default: '3306' },
          { name: 'database', label: 'Database', type: 'text', required: true, default: 'shop' },
          { name: 'username', label: 'Username', type: 'text', required: true, default: 'readonly' },
          { name: 'password', label: 'Password', type: 'password', secret: true, required: true, default: 'secret' },
        ],
      },
      actions: [{ id: 'submit', label: 'Connect', kind: 'primary' }],
    }],
  });

  const renderPanel = () => render(
    <DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />,
  );

  it('is marked required and keeps "Label" as its accessible name', async () => {
    setForm(CID, MYSQL_SPEC);
    renderPanel();

    const label = await screen.findByLabelText(/^Label$/i);
    expect(label).toHaveAttribute('aria-required', 'true');
    const caption = screen.getByText('Label', { selector: 'label' });
    expect(caption.parentElement.textContent).toBe('Label*');
  });

  it('stops an empty Label at the field, with focus on it and nothing sent', async () => {
    setForm(CID, MYSQL_SPEC);
    renderPanel();

    const label = await screen.findByLabelText(/^Label$/i);
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByText('Label is required.')).toBeInTheDocument();
    await waitFor(() => expect(label).toHaveFocus());
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
    // The inline error replaces the message the payload builder would raise.
    expect(screen.queryByText(/give this connection a name/i)).toBeNull();

    await userEvent.type(label, 'Shop');
    expect(screen.queryByText('Label is required.')).toBeNull();
  });

  it('treats a Label of only spaces as empty', async () => {
    setForm(CID, MYSQL_SPEC);
    renderPanel();

    const label = await screen.findByLabelText(/^Label$/i);
    await userEvent.type(label, '   ');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByText('Label is required.')).toBeInTheDocument();
    await waitFor(() => expect(label).toHaveFocus());
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
  });

  it('stops an edit whose Label was cleared instead of saving under the old name', async () => {
    setForm(CID, {
      ...SPEC,
      _datasource_edit: { id: 7, expectedRevision: 6 },
      name: 'Analytics',
      user_label: 'Analytics',
    });
    renderPanel();

    const label = await screen.findByLabelText(/^Label$/i);
    await userEvent.clear(label);
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByText('Label is required.')).toBeInTheDocument();
    await waitFor(() => expect(label).toHaveFocus());
    expect(api.editDatasourceConnection).not.toHaveBeenCalled();
  });

  it('drops its error when a different form replaces this one', async () => {
    const { rerender } = render(
      <DataVaultForm spec={MYSQL_SPEC} userLabel="" onUserLabelChange={vi.fn()} onAction={vi.fn()} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: /connect/i }));
    expect(await screen.findByText('Label is required.')).toBeInTheDocument();

    rerender(
      <DataVaultForm spec={{ ...MYSQL_SPEC, form_id: 'postgres-connector' }} userLabel="" onUserLabelChange={vi.fn()} onAction={vi.fn()} />,
    );
    await waitFor(() => expect(screen.queryByText('Label is required.')).toBeNull());
  });

  it('stays optional on a form that does not go to the relay', async () => {
    const onAction = vi.fn();
    const { _cloud_datasource: _unused, ...localSpec } = MYSQL_SPEC;
    render(<DataVaultForm spec={localSpec} userLabel="" onUserLabelChange={vi.fn()} onAction={onAction} />);

    const label = await screen.findByLabelText(/^Label$/i);
    expect(label).not.toHaveAttribute('aria-required');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Label is required.')).toBeNull();
  });

  it('keeps an agent field error to its own field, whatever the field is called', async () => {
    const spec = {
      form_id: 'agent-form',
      title: 'Connect something',
      fields: [{ name: '__user_label__', label: 'Workspace', type: 'text', required: true }],
      actions: [{ id: 'submit', label: 'Connect', kind: 'primary' }],
    };
    render(<DataVaultForm spec={spec} userLabel="" onUserLabelChange={vi.fn()} onAction={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /connect/i }));

    // Not repeated under the Label, and not cleared by typing a Label.
    expect(await screen.findAllByText('Workspace is required.')).toHaveLength(1);
    await userEvent.type(screen.getByLabelText(/^Label$/i), 'a');
    expect(screen.getAllByText('Workspace is required.')).toHaveLength(1);
  });
});

// No agent reads the skipped set on the relay path, and the server refuses a
// missing database, username or password, so "skip" would promise nothing.
describe('skipping a field', () => {
  it('is not offered on a cloud database form, so a blank password is caught inline', async () => {
    setForm(CID, toCloudSpec({
      ...SPEC,
      _cloud_datasource: undefined,
      methods: SPEC.methods.map((m) => ({ ...m, cloud: { available: true, fields: m.fields } })),
    }));
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);

    const password = await screen.findByLabelText(/^Password$/i);
    expect(screen.queryByRole('button', { name: /^skip$/i })).toBeNull();

    await userEvent.clear(password);
    await userEvent.type(screen.getByLabelText(/^Label$/i), 'Analytics');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByText('Password is required.')).toBeInTheDocument();
    // The Label was filled, so only the password is reported.
    expect(screen.queryByText('Label is required.')).toBeNull();
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
  });

  it('is still offered on a form the agent handles, and the skip reaches it', async () => {
    const onAction = vi.fn();
    const { _cloud_datasource: _unused, ...agentSpec } = SPEC;
    render(<DataVaultForm spec={agentSpec} userLabel="Analytics" onUserLabelChange={vi.fn()} onAction={onAction} />);

    await screen.findByLabelText(/^Password$/i);
    const skipButtons = screen.getAllByRole('button', { name: /^skip$/i });
    expect(skipButtons.length).toBe(agentSpec.methods[0].fields.length);

    // Fields render in spec order; password is the fourth.
    await userEvent.click(skipButtons[3]);
    expect(screen.getByText(/the agent will figure this one out/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].skipped).toEqual(['password']);
    expect(onAction.mock.calls[0][0].values).not.toHaveProperty('password');
  });
});

// The panel's error sits under the submit button, below the fold on a long
// database form, and used to outlive the mistake it described.
describe('a relay refusal on a cloud database form', () => {
  const MESSAGE = 'host must be reachable from the internet';
  let scrolled;
  let originalScrollIntoView;

  // Shaped the way api.js's responseError builds a 4xx refusal.
  const refusal = () => Object.assign(new Error(MESSAGE), { status: 400, code: 'invalid_connection' });
  const scrolledToMessage = () => scrolled.mock.contexts.filter((el) => el.textContent === MESSAGE).length;

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    api.createDatasourceConnection.mockRejectedValue(refusal());
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('scrolls the message into view, and again on a repeat refusal', async () => {
    await submitTheForm();
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(scrolledToMessage()).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(api.createDatasourceConnection).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(scrolledToMessage()).toBe(2));
  });

  it('goes away once a field is edited', async () => {
    await submitTheForm();
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Host$/i), 'x');
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('goes away once the Label is edited', async () => {
    await submitTheForm();
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Label$/i), 'x');
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('leaves the error of a form the agent handles as it was', async () => {
    const AGENT_MESSAGE = 'agent submit refused';
    const { _cloud_datasource: _unused, ...agentSpec } = SPEC;
    setForm(CID, agentSpec);
    const onSubmit = vi.fn(async () => { throw new Error(AGENT_MESSAGE); });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} onContinue={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText(/^Label$/i), 'Analytics');
    await userEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(await screen.findByText(AGENT_MESSAGE)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Host$/i), 'x');
    expect(screen.getByText(AGENT_MESSAGE)).toBeInTheDocument();
    expect(scrolled.mock.contexts.filter((el) => el.textContent === AGENT_MESSAGE)).toHaveLength(0);
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
