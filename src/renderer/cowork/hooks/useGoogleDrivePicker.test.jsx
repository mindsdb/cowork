import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGoogleDrivePicker } from './useGoogleDrivePicker';

// Regression coverage for the "streamline Add files from Google Drive"
// fix: connecting when not-yet-connected must fire host.oauthConnect
// directly (no connector-setup task/form), and a failed/cancelled connect
// must actually surface an error instead of silently hanging.

const apiMock = vi.hoisted(() => ({
  fetchDatasources: vi.fn(),
  fetchSavedConnection: vi.fn(),
  deletePickedFile: vi.fn(),
  fetchConnector: vi.fn(),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
}));
vi.mock('../api', () => apiMock);

const hostMock = vi.hoisted(() => ({
  oauthConnect: vi.fn(),
  pickDriveFiles: vi.fn(),
  openExternal: vi.fn(),
  isWeb: false,
}));
vi.mock('../../platform/host', () => ({ host: hostMock }));

const NOT_CONNECTED = { connections: [] };
const CONNECTED = {
  connections: [{ engine: 'google_drive', name: 'user-gmail-com', created_at: '2026-01-01T00:00:00Z' }],
};

function setup() {
  return renderHook(() => useGoogleDrivePicker({
    selectedProject: { name: 'general' },
    currentTask: null,
    setComposerAttachments: vi.fn(),
    setActiveTaskId: vi.fn(),
    setRoute: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  hostMock.isWeb = false;
});

// A minimal stand-in for the popup window.open('', '_blank') returns —
// just enough to observe the redirect (location.href) and the close() call.
function fakePopup() {
  return { location: { href: '' }, close: vi.fn() };
}

describe('useGoogleDrivePicker — connect flow (not yet connected)', () => {
  it('fires oauthConnect directly and opens the picker on success — no connector-setup task involved', async () => {
    apiMock.fetchDatasources
      .mockResolvedValueOnce(NOT_CONNECTED) // handleAddGoogleDriveFiles's initial check
      .mockResolvedValueOnce(CONNECTED);    // addGoogleDriveFiles's post-connect lookup
    hostMock.oauthConnect.mockResolvedValueOnce({ ok: true, name: 'user-gmail-com', account_email: 'user@gmail.com' });
    apiMock.fetchSavedConnection.mockResolvedValueOnce({ fields: { account_email: 'user@gmail.com' } });
    hostMock.pickDriveFiles.mockResolvedValueOnce({ ok: true, files: [], newFiles: [] });

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    // Wait for the confirm-connect prompt to be set, then confirm it.
    await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
    act(() => { result.current.confirmDriveConnect(); });
    await addPromise;

    expect(hostMock.oauthConnect).toHaveBeenCalledWith({ engine: 'google_drive', name: '' });
    expect(hostMock.pickDriveFiles).toHaveBeenCalledTimes(1);
  });

  it('throws (and never opens the picker) when oauthConnect reports failure', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);
    hostMock.oauthConnect.mockResolvedValueOnce({ ok: false, reason: 'OAuth timed out.' });

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
    act(() => { result.current.confirmDriveConnect(); });

    await expect(addPromise).rejects.toThrow('OAuth timed out.');
    expect(hostMock.pickDriveFiles).not.toHaveBeenCalled();
  });

  it('does not call oauthConnect at all when the user cancels the connect prompt', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
    act(() => { result.current.cancelDriveConnect(); });
    await addPromise;

    expect(hostMock.oauthConnect).not.toHaveBeenCalled();
    expect(hostMock.pickDriveFiles).not.toHaveBeenCalled();
  });
});

// Regression coverage for the bug found testing ENG gcal/gads/ganalytics
// rollout on cowork.staging.mindshub.ai: host.oauthConnect() is an
// Electron-only stub (see platform/host.ts) that fails immediately on web,
// so this path used to no-op with a toast error instead of connecting.
describe('useGoogleDrivePicker — connect flow (web, no Electron IPC)', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('drives the server-side redirect OAuth flow instead of host.oauthConnect, and opens the picker once the poll reports success', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup);
    apiMock.fetchDatasources
      .mockResolvedValueOnce(NOT_CONNECTED) // handleAddGoogleDriveFiles's initial check
      .mockResolvedValueOnce(CONNECTED);    // addGoogleDriveFiles's post-connect lookup
    apiMock.fetchConnector.mockResolvedValueOnce({
      form: { methods: [{ id: 'browser_oauth_builtin', oauth: { service_id: 'google-drive' } }] },
    });
    apiMock.startConnectorOAuth.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/o/oauth2/auth', state: 'abc123' });
    apiMock.pollConnectorOAuth.mockResolvedValueOnce({ status: 'success' });
    apiMock.fetchSavedConnection.mockResolvedValueOnce({ fields: { account_email: 'user@gmail.com' } });
    hostMock.pickDriveFiles.mockResolvedValueOnce({ ok: true, files: [], newFiles: [] });

    try {
      const { result } = setup();

      let addPromise;
      act(() => {
        addPromise = result.current.handleAddGoogleDriveFiles('general');
      });
      await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
      act(() => { result.current.confirmDriveConnect(); });
      await vi.advanceTimersByTimeAsync(3000);
      await addPromise;

      expect(hostMock.oauthConnect).not.toHaveBeenCalled();
      expect(apiMock.fetchConnector).toHaveBeenCalledWith('google_drive');
      expect(apiMock.startConnectorOAuth).toHaveBeenCalledWith('google-drive', {});
      // Popup opened blank, synchronously, before either network call —
      // the real URL only lands via location.href once it's known.
      expect(openSpy).toHaveBeenCalledWith('', '_blank');
      expect(popup.location.href).toBe('https://accounts.google.com/o/oauth2/auth');
      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(hostMock.pickDriveFiles).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to host.openExternal when the popup is blocked', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockReturnValue(null);
    hostMock.openExternal.mockResolvedValueOnce(undefined);
    apiMock.fetchDatasources
      .mockResolvedValueOnce(NOT_CONNECTED)
      .mockResolvedValueOnce(CONNECTED);
    apiMock.fetchConnector.mockResolvedValueOnce({
      form: { methods: [{ id: 'browser_oauth_builtin', oauth: { service_id: 'google-drive' } }] },
    });
    apiMock.startConnectorOAuth.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/o/oauth2/auth', state: 'abc123' });
    apiMock.pollConnectorOAuth.mockResolvedValueOnce({ status: 'success' });
    apiMock.fetchSavedConnection.mockResolvedValueOnce({ fields: { account_email: 'user@gmail.com' } });
    hostMock.pickDriveFiles.mockResolvedValueOnce({ ok: true, files: [], newFiles: [] });

    try {
      const { result } = setup();

      let addPromise;
      act(() => {
        addPromise = result.current.handleAddGoogleDriveFiles('general');
      });
      await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
      act(() => { result.current.confirmDriveConnect(); });
      await vi.advanceTimersByTimeAsync(3000);
      await addPromise;

      expect(hostMock.openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
      expect(hostMock.pickDriveFiles).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws (and never opens the picker) when the connector spec has no browser_oauth_builtin service_id', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);
    apiMock.fetchConnector.mockResolvedValueOnce({ form: { methods: [] } });

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
    act(() => { result.current.confirmDriveConnect(); });

    await expect(addPromise).rejects.toThrow('No OAuth configuration for Google Drive.');
    expect(hostMock.oauthConnect).not.toHaveBeenCalled();
    expect(apiMock.startConnectorOAuth).not.toHaveBeenCalled();
    expect(hostMock.pickDriveFiles).not.toHaveBeenCalled();
  });

  it('throws (and never opens the picker) when the OAuth poll reports an error', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockReturnValue(null);
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);
    apiMock.fetchConnector.mockResolvedValueOnce({
      form: { methods: [{ id: 'browser_oauth_builtin', oauth: { service_id: 'google-drive' } }] },
    });
    apiMock.startConnectorOAuth.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/o/oauth2/auth', state: 'abc123' });
    apiMock.pollConnectorOAuth.mockResolvedValueOnce({ status: 'error', error: 'Consent denied.' });

    try {
      const { result } = setup();

      let addPromise;
      act(() => {
        addPromise = result.current.handleAddGoogleDriveFiles('general');
      });
      await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
      act(() => { result.current.confirmDriveConnect(); });
      // Attach the rejection expectation before advancing timers so the
      // promise is never unobserved between rejecting and being asserted on.
      const expectation = expect(addPromise).rejects.toThrow('Consent denied.');
      await vi.advanceTimersByTimeAsync(3000);
      await expectation;
      expect(hostMock.pickDriveFiles).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
