// A connector with both a cloud database form and an OAuth method, shaped the
// way org mode shapes every spec (toCloudSpec), still signs in through OAuth.
//
// Supabase is the case: once its credentials method has a cloud block, the
// OAuth method must survive the shaping and must never post to the datasource
// route, where a password form goes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  createDatasourceConnection: vi.fn(),
  editDatasourceConnection: vi.fn(),
  saveConnector: vi.fn(),
  fetchDatasources: vi.fn(async () => []),
  startConnectorOAuth: vi.fn(async () => ({ authUrl: 'https://api.supabase.com/x', state: 's' })),
  pollConnectorOAuth: vi.fn(async () => ({ status: 'pending' })),
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
import { toCloudSpec } from '../../lib/cloudConnectorSpec';

const CID = 'conv-supabase-oauth';

// Method ids, OAuth block and desktop field names as cowork-server's
// supabase.json serves them; the cloud block as postgres's.
const supabase = (cloudAvailable) => ({
  form_id: 'supabase-connector',
  title: 'Connect Supabase',
  engine: 'supabase',
  _connector_id: 'supabase',
  methods: [
    {
      id: 'browser_oauth_builtin',
      label: 'Authorize with Supabase',
      recommended: true,
      hidden: false,
      fields: [],
      oauth: {
        auth_url: 'https://api.supabase.com/v1/oauth/authorize',
        token_url: 'https://api.supabase.com/v1/oauth/token',
        scopes: ['projects:read', 'organizations:read'],
        service_id: 'supabase',
      },
    },
    { id: 'connection-string', label: 'Connection String', fields: [{ name: 'connection_string', type: 'password' }] },
    {
      id: 'individual-credentials',
      label: 'Host / Port / Database / User / Password',
      fields: ['host', 'port', 'database', 'user', 'password', 'ssl_mode'].map((name) => ({ name, type: 'text' })),
      cloud: {
        available: cloudAvailable,
        engine: 'postgres:host-port',
        description: 'Cloud copy',
        how_to: 'Cloud how-to',
        // As cowork-server serves them: postgres's cloud fields.
        fields: [
          { name: 'host', label: 'Host', type: 'text', required: true },
          { name: 'port', label: 'Port', type: 'text', required: true, default: '5432' },
          { name: 'database', label: 'Database name', type: 'text', required: true },
          { name: 'schema', label: 'Schema', type: 'text' },
          { name: 'username', label: 'Username', type: 'text', required: true },
          { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
          { name: 'tls_verify', label: 'Certificate', type: 'boolean', checkbox_label: 'Only connect if the certificate is signed by a public authority' },
        ],
      },
    },
  ],
});

afterEach(() => {
  clearForm(CID);
  vi.clearAllMocks();
});

describe.each([
  ['while the cloud form is off', false],
  ['beside an enabled cloud form', true],
])('Supabase in org mode %s', (_label, cloudAvailable) => {
  it('signs in through OAuth and never posts to the datasource route', async () => {
    setForm(CID, toCloudSpec(supabase(cloudAvailable)));
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onContinue={vi.fn()} onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /authorize/i }));

    await waitFor(() => expect(api.startConnectorOAuth).toHaveBeenCalled());
    expect(api.createDatasourceConnection).not.toHaveBeenCalled();
  });
});
