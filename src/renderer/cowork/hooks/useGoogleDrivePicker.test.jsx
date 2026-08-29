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
}));
vi.mock('../api', () => apiMock);

const hostMock = vi.hoisted(() => ({
  oauthConnect: vi.fn(),
  pickDriveFiles: vi.fn(),
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
});

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
