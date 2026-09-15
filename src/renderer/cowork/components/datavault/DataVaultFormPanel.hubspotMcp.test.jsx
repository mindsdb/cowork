// ENG-487: HubSpot's connector uses a new method id, "mcp", not
// "browser_oauth_builtin" — it authenticates against HubSpot's MCP server
// rather than its REST API, but drives the identical one-click
// host.oauthConnect() PKCE flow. Regression coverage that the method-check
// widening (DataVaultFormPanel.jsx) actually recognizes it, mirroring
// DataVaultFormPanel.oauth.test.jsx's PostHog browser_oauth_builtin coverage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchDatasources: vi.fn() };
});

const oauthConnectMock = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isElectron: true, oauthConnect: oauthConnectMock } };
});

const CID = 'conv-datavault-hubspot-mcp';

const HUBSPOT_MCP_SPEC = {
  form_id: 'hubspot-connector',
  _connector_id: 'hubspot',
  engine: 'hubspot',
  title: 'Connect HubSpot',
  methods: [
    {
      id: 'mcp',
      label: 'In-Browser Connect',
      oauth: { auth_url: 'https://mcp.hubspot.com/oauth/authorize/user', token_url: 'https://mcp.hubspot.com/oauth/v3/token' },
      fields: [],
    },
  ],
};

describe('DataVaultFormPanel — HubSpot mcp method', () => {
  beforeEach(() => {
    clearForm(CID);
    oauthConnectMock.mockReset();
    oauthConnectMock.mockResolvedValue({ ok: true, name: 'hubspot-conn' });
  });

  it('goes straight to host.oauthConnect for the "mcp" method, same as browser_oauth_builtin', async () => {
    setForm(CID, HUBSPOT_MCP_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit|connect/i }));

    expect(oauthConnectMock).toHaveBeenCalledTimes(1);
    expect(oauthConnectMock).toHaveBeenCalledWith(expect.objectContaining({ engine: 'hubspot' }));
  });
});
