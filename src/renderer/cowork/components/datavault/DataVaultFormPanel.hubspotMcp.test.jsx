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

// A two-method spec is what makes the picker's hero-promotion UI (ENG-1534)
// render at all — a single-method spec (like the test above) auto-selects its
// only method and skips the picker/hero entirely, so it can't exercise the
// hero one-click path.
//
// This is a fixture, not a copy of HubSpot's real spec: that one now hides
// `private-app` so OAuth is its sole offered method (App Marketplace listing
// requirement), which means HubSpot itself takes the auto-select path above.
// Kept two-method here because some connector has to cover the hero path.
const HUBSPOT_TWO_METHOD_SPEC = {
  ...HUBSPOT_MCP_SPEC,
  methods: [
    { id: 'mcp', label: 'In-Browser Connect', recommended: true, fields: [] },
    { id: 'private-app', label: 'Private app token', fields: [{ name: 'access_token', required: true }] },
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

  // Found in code review: methodHero.js's heroIsOAuth check and
  // DataVaultFormPanel's onMethodChange auto-start gate both still only
  // recognized 'browser_oauth_builtin', so clicking HubSpot's promoted
  // hero silently degraded to a two-click flow (select, then Submit)
  // instead of launching OAuth immediately like every other zero-field
  // recommended connector.
  it('launches OAuth in one click from the promoted hero button, not two', async () => {
    setForm(CID, HUBSPOT_TWO_METHOD_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Authorize with HubSpot/i }));

    expect(oauthConnectMock).toHaveBeenCalledTimes(1);
    expect(oauthConnectMock).toHaveBeenCalledWith(expect.objectContaining({ engine: 'hubspot' }));
  });

  // HubSpot's shipping shape once `private-app` was hidden for the App
  // Marketplace listing: ONE visible method, recommended, zero fields.
  // That tripped DataVaultForm's single-method auto-select, which opens
  // straight onto the method's fields — of which there are none — so the
  // user got an empty dialog whose only control was "Submit", instead of
  // the "Authorize with HubSpot" hero every other OAuth connector shows.
  const HUBSPOT_SOLE_METHOD_SPEC = {
    ...HUBSPOT_MCP_SPEC,
    methods: [
      {
        id: 'mcp',
        label: 'In-Browser Connect',
        recommended: true,
        fields: [],
        oauth: { auth_url: 'https://mcp.hubspot.com/oauth/authorize/user' },
      },
    ],
  };

  it('still shows the Authorize hero when OAuth is the only visible method', async () => {
    setForm(CID, HUBSPOT_SOLE_METHOD_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    expect(screen.getByRole('button', { name: /Authorize with HubSpot/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^submit$/i })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Authorize with HubSpot/i }));
    expect(oauthConnectMock).toHaveBeenCalledWith(expect.objectContaining({ engine: 'hubspot' }));
  });
});
