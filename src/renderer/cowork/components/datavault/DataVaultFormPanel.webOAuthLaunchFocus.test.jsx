// BYOK oauth_launch owns a popup reference, unlike builtin OAuth.
// On success it must close that popup and request app-tab focus.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { startConnectorOAuth, pollConnectorOAuth } from '../../api';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startConnectorOAuth: vi.fn(),
    pollConnectorOAuth: vi.fn(),
  };
});

vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isElectron: false, isWeb: true, openExternal: vi.fn() } };
});

const CID = 'conv-datavault-web-oauth-launch-focus';

const BYOK_SPEC = {
  form_id: 'drive-byok-f1',
  _connector_id: 'google_drive',
  engine: 'google_drive',
  title: 'Connect Google Drive',
  methods: [
    {
      id: 'oauth',
      label: 'Sign in with Google',
      submit_action: 'oauth_launch',
      fields: [],
      oauth: {
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        scopes: ['openid'],
        client_id: 'hosted-client-id',
      },
    },
  ],
};

describe('DataVaultFormPanel — BYOK web OAuth (oauth_launch) closes popup and reclaims focus', () => {
  let focusSpy;
  let popup;

  beforeEach(() => {
    clearForm(CID);
    startConnectorOAuth.mockReset();
    pollConnectorOAuth.mockReset();
    popup = { location: {}, close: vi.fn() };
    vi.spyOn(window, 'open').mockImplementation(() => popup);
    focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the retained popup and calls window.focus() once the poll reports success', async () => {
    startConnectorOAuth.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/auth?x', state: 's1' });
    pollConnectorOAuth.mockResolvedValue({ status: 'success', label: 'Google Drive' });

    setForm(CID, BYOK_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    fireEvent.click(screen.getByRole('button', { name: /submit|connect/i }));
    await vi.waitFor(() => expect(startConnectorOAuth).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(2000); // POLL_MS in the oauth_launch branch
    await vi.waitFor(() => expect(pollConnectorOAuth).toHaveBeenCalledWith('s1'));

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
