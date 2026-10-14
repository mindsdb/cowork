// Regression coverage for the browser_oauth_builtin PostHog path: it must
// stay a one-step "click Connect, browser opens" flow — no form fields, no
// personal-api-key project discovery (ENG-1602, which only applies to that
// method — OAuth has no personal_api_key/host fields to probe with).
// PostHog's project_id (needed by the connector engine, never surfaced by
// the OAuth consent screen) is discovered behind the scenes in the main
// process after the token exchange, not via a form field — see
// oauth-posthog-projects.ts and index.ts's IPC.OAUTH_CONNECT handler.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { discoverPostHogProjects } from '../../api';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, discoverPostHogProjects: vi.fn(), fetchDatasources: vi.fn() };
});

const oauthConnectMock = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isElectron: true, oauthConnect: oauthConnectMock } };
});

const CID = 'conv-datavault-posthog-oauth';

const POSTHOG_OAUTH_SPEC = {
  form_id: 'posthog-oauth-f1',
  _connector_id: 'posthog',
  engine: 'posthog',
  title: 'Connect PostHog',
  methods: [
    {
      id: 'browser_oauth_builtin',
      label: 'In-Browser Connect',
      oauth: { service_id: 'posthog' },
      fields: [],
    },
  ],
};

describe('DataVaultFormPanel — PostHog browser_oauth_builtin', () => {
  beforeEach(() => {
    clearForm(CID);
    discoverPostHogProjects.mockReset();
    oauthConnectMock.mockReset();
    oauthConnectMock.mockResolvedValue({ ok: true, name: 'posthog-conn' });
  });

  it('goes straight to host.oauthConnect with no method-specific fields shown', async () => {
    setForm(CID, POSTHOG_OAUTH_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    // "Label" is the generic, every-connector name field rendered above the
    // method's own fields regardless of spec — it's the only textbox that
    // should exist here. A method-specific field (e.g. a project_id input)
    // would mean this stopped being a one-click "click Connect" flow.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByLabelText('Label')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit|connect/i }));

    expect(oauthConnectMock).toHaveBeenCalledTimes(1);
    expect(oauthConnectMock).toHaveBeenCalledWith(expect.objectContaining({ engine: 'posthog' }));
  });

  it('never runs personal-api-key project discovery for the OAuth method', async () => {
    setForm(CID, POSTHOG_OAUTH_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit|connect/i }));

    expect(discoverPostHogProjects).not.toHaveBeenCalled();
  });
});

// Regression coverage for a browser_oauth_builtin method that ALSO declares
// its own non-OAuth required field (Google Ads' developer_token) — the
// filled field value must reach host.oauthConnect as extraFields so the
// main process can persist it, not get dropped on the floor.
const ADS_CID = 'conv-datavault-ads-oauth';

const GOOGLE_ADS_OAUTH_SPEC = {
  form_id: 'google-ads-oauth-f1',
  _connector_id: 'google_ads',
  engine: 'google_ads',
  title: 'Connect Google Ads',
  methods: [
    {
      id: 'browser_oauth_builtin',
      label: 'In-Browser Connect',
      oauth: { service_id: 'google-ads' },
      fields: [
        { name: 'developer_token', label: 'Developer Token', type: 'password', required: true, secret: true },
        { name: 'login_customer_id', label: 'Login Customer ID (MCC)', type: 'text', required: false },
      ],
    },
  ],
};

describe('DataVaultFormPanel — Google Ads browser_oauth_builtin (extra fields)', () => {
  beforeEach(() => {
    clearForm(ADS_CID);
    oauthConnectMock.mockReset();
    oauthConnectMock.mockResolvedValue({ ok: true, name: 'ads-conn' });
  });

  it('forwards the filled developer_token field to host.oauthConnect as extraFields', async () => {
    setForm(ADS_CID, GOOGLE_ADS_OAUTH_SPEC);
    render(<DataVaultFormPanel conversationId={ADS_CID} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Developer Token'), 'ABCDE-FGHIJ-KLMNO');
    await user.click(screen.getByRole('button', { name: /submit|connect/i }));

    expect(oauthConnectMock).toHaveBeenCalledTimes(1);
    expect(oauthConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'google_ads',
        extraFields: expect.objectContaining({ developer_token: 'ABCDE-FGHIJ-KLMNO' }),
      }),
    );
  });
});
