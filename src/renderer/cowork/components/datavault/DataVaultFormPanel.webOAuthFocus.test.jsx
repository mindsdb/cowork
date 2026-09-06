// Web must explicitly request app-tab focus when OAuth polling succeeds; Electron's native window
// behavior is separate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { startConnectorOAuth, pollConnectorOAuth, fetchDatasources } from '../../api';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startConnectorOAuth: vi.fn(),
    pollConnectorOAuth: vi.fn(),
    fetchDatasources: vi.fn(async () => ({})),
  };
});

vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isElectron: false, isWeb: true, openExternal: vi.fn() } };
});

const CID = 'conv-datavault-web-oauth-focus';

// Use the recommended no-fields builtin method, separate from BYOK oauth_launch.
const DRIVE_BUILTIN_SPEC = {
  form_id: 'drive-builtin-f1',
  _connector_id: 'google_drive',
  engine: 'google_drive',
  title: 'Connect Google Drive',
  methods: [
    {
      id: 'browser_oauth_builtin',
      label: 'In-Browser Connect',
      recommended: true,
      fields: [],
      oauth: { service_id: 'google-drive' },
    },
  ],
};

describe('DataVaultFormPanel — web OAuth reclaims focus on success', () => {
  let focusSpy;

  beforeEach(() => {
    clearForm(CID);
    startConnectorOAuth.mockReset();
    pollConnectorOAuth.mockReset();
    fetchDatasources.mockReset().mockResolvedValue({});
    vi.spyOn(window, 'open').mockImplementation(() => null);
    focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls window.focus() once the poll reports success', async () => {
    startConnectorOAuth.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/auth?x', state: 's1' });
    pollConnectorOAuth.mockResolvedValue({ status: 'success', label: 'Google Drive' });

    setForm(CID, DRIVE_BUILTIN_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    fireEvent.click(screen.getByRole('button', { name: /submit|connect/i }));
    // startConnectorOAuth() is awaited before the poll interval is armed.
    await vi.waitFor(() => expect(startConnectorOAuth).toHaveBeenCalled());

    expect(focusSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000); // BROWSER_OAUTH_POLL_MS
    await vi.waitFor(() => expect(pollConnectorOAuth).toHaveBeenCalledWith('s1'));

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('does not call window.focus() while still pending', async () => {
    startConnectorOAuth.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/auth?x', state: 's1' });
    pollConnectorOAuth.mockResolvedValue({ status: 'pending' });

    setForm(CID, DRIVE_BUILTIN_SPEC);
    render(<DataVaultFormPanel conversationId={CID} />);

    fireEvent.click(screen.getByRole('button', { name: /submit|connect/i }));
    await vi.waitFor(() => expect(startConnectorOAuth).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(pollConnectorOAuth).toHaveBeenCalledWith('s1'));

    expect(focusSpy).not.toHaveBeenCalled();
  });
});
