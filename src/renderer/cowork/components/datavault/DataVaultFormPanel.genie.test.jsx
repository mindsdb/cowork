// The Databricks Genie method id is not in HOSTED_OAUTH_METHOD_IDS, so it
// must render as a plain credential form and never as a browser sign-in.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';

const CID = 'conv-datavault-genie';
const WORKSPACE_URL = 'https://dbc-1.cloud.databricks.com';
const CLIENT_ID = 'sentinel-client-id';
const CLIENT_SECRET = 'sentinel-secret-1';
const SPACE_ID = '0123456789abcdef0123456789abcdef';

const DATABRICKS_SPEC = {
  form_id: 'databricks-f1',
  _connector_id: 'databricks',
  title: 'Connect Databricks',
  selected_method: 'genie-mcp',
  methods: [
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
  ],
};

describe('DataVaultFormPanel — Databricks Genie method', () => {
  beforeEach(() => {
    clearForm(CID);
    setForm(CID, DATABRICKS_SPEC);
  });

  it('renders the four credential fields and no browser sign-in button', () => {
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/workspace url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/genie space id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client secret/i)).toHaveAttribute('type', 'password');
    expect(screen.queryByRole('button', { name: /authorize|sign in/i })).not.toBeInTheDocument();
  });

  it('hands method genie-mcp and the four values to the host on submit', async () => {
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/workspace url/i), WORKSPACE_URL);
    await user.type(screen.getByLabelText(/client id/i), CLIENT_ID);
    await user.type(screen.getByLabelText(/client secret/i), CLIENT_SECRET);
    await user.type(screen.getByLabelText(/genie space id/i), SPACE_ID);
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      method: 'genie-mcp',
      formSpec: expect.objectContaining({ selected_method: 'genie-mcp' }),
      values: expect.objectContaining({
        workspace_url: WORKSPACE_URL,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        genie_space_id: SPACE_ID,
      }),
    }));
  });
});
