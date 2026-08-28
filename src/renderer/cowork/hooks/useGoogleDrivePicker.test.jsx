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
  preopenDrivePickerPopup: vi.fn(),
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

// Regression coverage for the popup-blocked fix (ENG-208, review round 2):
// these entry points await connection fetches before host.pickDriveFiles
// ever runs, so the picker window must be pre-opened synchronously at the
// click boundary (host.preopenDrivePickerPopup) and threaded through —
// otherwise the click's transient activation has expired and browsers
// silently block the popup for exactly the core composer/project flows.
describe('useGoogleDrivePicker — click-boundary popup pre-open', () => {
  it('pre-opens the popup synchronously before any fetch and passes the handle to pickDriveFiles', async () => {
    const fakePopup = { closed: false, close: vi.fn() };
    hostMock.preopenDrivePickerPopup.mockReturnValueOnce(fakePopup);
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    apiMock.fetchSavedConnection.mockResolvedValueOnce({ fields: { account_email: 'user@gmail.com' } });
    hostMock.pickDriveFiles.mockResolvedValueOnce({ ok: true, files: [], newFiles: [] });

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    // Already called in the click's own tick — before the first await could
    // have expired the activation.
    expect(hostMock.preopenDrivePickerPopup).toHaveBeenCalledTimes(1);
    expect(hostMock.preopenDrivePickerPopup.mock.invocationCallOrder[0])
      .toBeLessThan(apiMock.fetchDatasources.mock.invocationCallOrder[0]);
    await addPromise;

    expect(hostMock.pickDriveFiles).toHaveBeenCalledWith(
      'google_drive', 'user-gmail-com', 'user@gmail.com', undefined, 'general', fakePopup,
    );
    // Consumed by pickDriveFiles, not abandoned.
    expect(fakePopup.close).not.toHaveBeenCalled();
  });

  it('closes the pre-opened popup when the user dismisses the account-choice modal', async () => {
    const fakePopup = { closed: false, close: vi.fn() };
    hostMock.preopenDrivePickerPopup.mockReturnValueOnce(fakePopup);
    apiMock.fetchDatasources.mockResolvedValueOnce({
      connections: [
        { engine: 'google_drive', name: 'a-gmail-com', created_at: '2026-01-01T00:00:00Z' },
        { engine: 'google_drive', name: 'b-gmail-com', created_at: '2026-02-01T00:00:00Z' },
      ],
    });

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    await vi.waitUntil(() => result.current.driveAccountChoice !== null);
    act(() => { result.current.cancelDriveAccountChoice(); });
    await addPromise;

    expect(fakePopup.close).toHaveBeenCalledTimes(1);
    expect(hostMock.pickDriveFiles).not.toHaveBeenCalled();
  });

  it('closes the pre-opened popup before detouring into the connect flow (no blank window under the confirm modal)', async () => {
    const fakePopup = { closed: false, close: vi.fn() };
    hostMock.preopenDrivePickerPopup.mockReturnValueOnce(fakePopup);
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveFiles('general');
    });
    await vi.waitUntil(() => result.current.driveConnectPrompt !== null);
    // Popup already closed before the user even answers the prompt.
    expect(fakePopup.close).toHaveBeenCalledTimes(1);
    act(() => { result.current.cancelDriveConnect(); });
    await addPromise;
  });

  it('pre-opens and threads the handle for the project-files entry point too', async () => {
    const fakePopup = { closed: false, close: vi.fn() };
    hostMock.preopenDrivePickerPopup.mockReturnValueOnce(fakePopup);
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    apiMock.fetchSavedConnection.mockResolvedValueOnce({ fields: { account_email: 'user@gmail.com' } });
    hostMock.pickDriveFiles.mockResolvedValueOnce({ ok: true, files: [{ id: 'f1' }], newFiles: [] });

    const { result } = setup();

    let addPromise;
    act(() => {
      addPromise = result.current.handleAddGoogleDriveProjectFiles('proj-1');
    });
    expect(hostMock.preopenDrivePickerPopup).toHaveBeenCalledTimes(1);
    await addPromise;

    expect(hostMock.pickDriveFiles).toHaveBeenCalledWith(
      'google_drive', 'user-gmail-com', 'user@gmail.com', undefined, 'proj-1', fakePopup,
    );
  });
});
