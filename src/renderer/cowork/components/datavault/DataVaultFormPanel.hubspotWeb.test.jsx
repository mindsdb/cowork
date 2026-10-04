// HubSpot on the web SPA: its OAuth method id is "mcp", not
// "browser_oauth_builtin", so the web fallback has to find the service_id on
// the method the user actually chose. Both connect paths are covered — the
// Submit path (handleAction) and the one-click Authorize hero (onMethodChange)
// — since they look the method up separately.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { startConnectorOAuth } from '../../api';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, startConnectorOAuth: vi.fn(), pollConnectorOAuth: vi.fn() };
});

vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isElectron: false, isWeb: true, openExternal: vi.fn() } };
});

const CID = 'conv-datavault-hubspot-web';

const MCP_METHOD = {
  id: 'mcp',
  label: 'In-Browser Connect',
  fields: [],
  oauth: {
    auth_url: 'https://mcp.hubspot.com/oauth/authorize/user',
    token_url: 'https://mcp.hubspot.com/oauth/v3/token',
    service_id: 'hubspot',
  },
};

const spec = (method) => ({
  form_id: 'hubspot-connector',
  _connector_id: 'hubspot',
  engine: 'hubspot',
  title: 'Connect HubSpot',
  methods: [method],
});

describe('DataVaultFormPanel — HubSpot mcp method on the web', () => {
  beforeEach(() => {
    clearForm(CID);
    startConnectorOAuth.mockReset();
    startConnectorOAuth.mockResolvedValue({ authUrl: 'https://mcp.hubspot.com/oauth/authorize/user?x', state: 's1' });
    vi.spyOn(window, 'open').mockImplementation(() => ({ location: {}, close: vi.fn() }));
  });

  it('starts the server-side OAuth flow from Submit instead of refusing', async () => {
    setForm(CID, spec(MCP_METHOD));
    render(<DataVaultFormPanel conversationId={CID} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit|connect/i }));

    await vi.waitFor(() => expect(startConnectorOAuth).toHaveBeenCalledTimes(1));
    expect(startConnectorOAuth.mock.calls[0][0]).toBe('hubspot');
    expect(screen.queryByText(/No OAuth configuration/i)).toBeNull();
  });

  it('starts the server-side OAuth flow from the Authorize hero', async () => {
    setForm(CID, spec({ ...MCP_METHOD, recommended: true }));
    render(<DataVaultFormPanel conversationId={CID} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Authorize with HubSpot/i }));

    await vi.waitFor(() => expect(startConnectorOAuth).toHaveBeenCalledTimes(1));
    expect(startConnectorOAuth.mock.calls[0][0]).toBe('hubspot');
  });
});
