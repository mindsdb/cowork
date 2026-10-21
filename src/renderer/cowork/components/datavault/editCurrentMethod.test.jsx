// A secret saved under a hidden `_` name must reach the form under the
// spec's field name, or the edit submits without it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { editCurrentFields, findSavedSpecMethod } from './editCurrentMethod';
import { CONNECTIONS_VAULT_KEEP } from '../../api';

const WORKSPACE_URL = 'https://dbc-1.cloud.databricks.com';
const SPACE_ID = '0123456789abcdef0123456789abcdef';
const NEW_SPACE_ID = 'fedcba9876543210fedcba9876543210';

const DATABRICKS_METHODS = [
  {
    id: 'personal-access-token',
    label: 'Personal access token',
    fields: [
      { name: 'workspace_url', label: 'Workspace URL', type: 'url', required: true },
      { name: 'access_token', label: 'Access token', type: 'password', required: true, secret: true },
      { name: 'http_path', label: 'HTTP path', type: 'text', required: true },
    ],
  },
  {
    id: 'genie-mcp',
    label: 'Genie space',
    fields: [
      { name: 'workspace_url', label: 'Workspace URL', type: 'url', required: true },
      { name: 'client_id', label: 'Client ID', type: 'text', required: true },
      { name: 'client_secret', label: 'Client secret', type: 'password', required: true, secret: true },
      { name: 'genie_space_id', label: 'Genie space ID', type: 'text', required: false },
    ],
  },
];

const HUBSPOT_METHODS = [
  {
    id: 'mcp',
    label: 'Sign in with HubSpot',
    fields: [{ name: 'access_token', label: 'Access token', type: 'password', secret: true }],
  },
  {
    id: 'private-app',
    label: 'Private app token',
    fields: [{ name: 'access_token', label: 'Access token', type: 'password', secret: true }],
  },
];

// Shape of the connections detail API: `_method` is lifted to `method`, and
// every secure field, hidden or not, is masked with the keep sentinel.
const GENIE_SAVED = {
  engine: 'databricks',
  name: 'genie-one',
  method: 'genie-mcp',
  fields: {
    workspace_url: WORKSPACE_URL,
    client_id: 'sentinel-client-id',
    _client_secret: CONNECTIONS_VAULT_KEEP,
    genie_space_id: SPACE_ID,
  },
  secureKeys: ['_client_secret'],
};

const HUBSPOT_SAVED = {
  engine: 'hubspot',
  name: 'hub-one',
  method: 'mcp',
  fields: {
    access_token: CONNECTIONS_VAULT_KEEP,
    refresh_token: CONNECTIONS_VAULT_KEEP,
    _access_mode: 'read',
    _picked_files: '[]',
  },
  secureKeys: ['access_token', 'refresh_token'],
};

const PAT_SAVED = {
  engine: 'databricks',
  name: 'pat-one',
  method: 'personal-access-token',
  fields: {
    workspace_url: WORKSPACE_URL,
    access_token: CONNECTIONS_VAULT_KEEP,
    http_path: '/sql/1.0/warehouses/abc',
  },
  secureKeys: ['access_token'],
};

const secretField = (name, label) => ({
  name, label, type: 'password', secret: true, required: false, default: CONNECTIONS_VAULT_KEEP,
});
const textField = (name, label, value) => ({
  name, label, type: 'text', secret: false, required: false, default: value,
});

describe('findSavedSpecMethod', () => {
  it('matches the method the detail API returns', () => {
    expect(findSavedSpecMethod(GENIE_SAVED, DATABRICKS_METHODS)?.id).toBe('genie-mcp');
  });

  it('still matches a record that carries `_method` in its fields', () => {
    const saved = { fields: { _method: 'genie-mcp' }, secureKeys: [] };
    expect(findSavedSpecMethod(saved, DATABRICKS_METHODS)?.id).toBe('genie-mcp');
  });

  it('does not match a non-Genie method from the detail API', () => {
    expect(findSavedSpecMethod(HUBSPOT_SAVED, HUBSPOT_METHODS)).toBeNull();
    expect(findSavedSpecMethod(PAT_SAVED, DATABRICKS_METHODS)).toBeNull();
  });

  it('returns null when the saved method is gone from the spec', () => {
    expect(findSavedSpecMethod({ method: 'retired', fields: {} }, DATABRICKS_METHODS)).toBeNull();
  });
});

describe('editCurrentFields', () => {
  it('shows a saved hidden secret under its spec field name', () => {
    const fields = editCurrentFields(GENIE_SAVED, findSavedSpecMethod(GENIE_SAVED, DATABRICKS_METHODS));
    expect(fields).toEqual([
      textField('workspace_url', 'Workspace Url', WORKSPACE_URL),
      textField('client_id', 'Client Id', 'sentinel-client-id'),
      secretField('client_secret', 'Client Secret'),
      textField('genie_space_id', 'Genie Space Id', SPACE_ID),
    ]);
  });

  it('keeps a hidden secret filtered when no spec method matches', () => {
    const fields = editCurrentFields(GENIE_SAVED, null);
    expect(fields.map((f) => f.name)).toEqual(['workspace_url', 'client_id', 'genie_space_id']);
  });

  it('keeps a hidden key filtered when it is not a secure key', () => {
    const saved = { ...GENIE_SAVED, secureKeys: [] };
    const fields = editCurrentFields(saved, findSavedSpecMethod(saved, DATABRICKS_METHODS));
    expect(fields.map((f) => f.name)).not.toContain('client_secret');
  });

  it('leaves a HubSpot record unchanged', () => {
    const fields = editCurrentFields(HUBSPOT_SAVED, findSavedSpecMethod(HUBSPOT_SAVED, HUBSPOT_METHODS));
    expect(fields).toEqual([
      secretField('access_token', 'Access Token'),
      secretField('refresh_token', 'Refresh Token'),
    ]);
  });

  it('leaves a personal access token record unchanged', () => {
    const fields = editCurrentFields(PAT_SAVED, findSavedSpecMethod(PAT_SAVED, DATABRICKS_METHODS));
    expect(fields).toEqual([
      textField('workspace_url', 'Workspace Url', WORKSPACE_URL),
      secretField('access_token', 'Access Token'),
      textField('http_path', 'Http Path', '/sql/1.0/warehouses/abc'),
    ]);
  });
});

function editFormFor(saved, methods, cid) {
  clearForm(cid);
  const matched = findSavedSpecMethod(saved, methods);
  setForm(cid, {
    form_id: 'edit',
    _connector_id: saved.engine,
    title: 'Connect',
    selected_method: '__edit_current__',
    _existing_name: saved.name,
    _secure_keys: saved.secureKeys,
    _modify: true,
    methods: [
      {
        id: '__edit_current__',
        label: 'Currently saved values',
        fields: editCurrentFields(saved, matched),
        _underlying_method: matched?.id || null,
      },
      ...methods,
    ],
  });
}

describe.each([
  ['HubSpot', HUBSPOT_SAVED, HUBSPOT_METHODS],
  ['Databricks personal access token', PAT_SAVED, DATABRICKS_METHODS],
])('editing a saved %s connection', (_label, saved, methods) => {
  it('keeps the edit method without an underlying method id', async () => {
    const cid = 'conv-datavault-nongenie-edit';
    editFormFor(saved, methods, cid);
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={cid} onSubmit={onSubmit} />);

    await userEvent.setup().click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].method).toBe('__edit_current__');
  });
});

describe('editing a saved Genie connection', () => {
  const CID = 'conv-datavault-genie-edit';

  beforeEach(() => {
    const matched = findSavedSpecMethod(GENIE_SAVED, DATABRICKS_METHODS);
    clearForm(CID);
    setForm(CID, {
      form_id: 'databricks-edit',
      _connector_id: 'databricks',
      title: 'Connect Databricks',
      selected_method: '__edit_current__',
      _existing_name: GENIE_SAVED.name,
      _secure_keys: GENIE_SAVED.secureKeys,
      _modify: true,
      methods: [
        {
          id: '__edit_current__',
          label: 'Currently saved values',
          fields: editCurrentFields(GENIE_SAVED, matched),
          _underlying_method: matched.id,
        },
        ...DATABRICKS_METHODS,
      ],
    });
  });

  it('sends the untouched secret as the keep sentinel under client_secret', async () => {
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/client secret/i)).toHaveAttribute('type', 'password');
    const user = userEvent.setup();
    const space = screen.getByLabelText(/genie space id/i);
    await user.clear(space);
    await user.type(space, NEW_SPACE_ID);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.method).toBe('genie-mcp');
    expect(payload.name).toBe('genie-one');
    expect(payload.values).toEqual(expect.objectContaining({
      workspace_url: WORKSPACE_URL,
      client_id: 'sentinel-client-id',
      client_secret: 'ANTON_VAULT_KEEP',
      genie_space_id: NEW_SPACE_ID,
    }));
    expect(payload.values).not.toHaveProperty('_client_secret');
  });
});
