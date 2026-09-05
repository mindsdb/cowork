// PostHog builtin OAuth must stay one-step; main discovers project_id after exchange, without
// personal-key discovery fields.
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

    // Only the generic Label textbox belongs in this OAuth flow; method-specific fields would add
    // an unintended setup step.
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
