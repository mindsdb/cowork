/*
 * The app-level surfaces that draw over the desktop browser pane count as
 * overlays, so the pane's native view, which draws above every part of the
 * page, steps aside: the narrow-band sidebar popout, and the OTA update
 * curtain while an update downloads and the UI reloads.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updates = vi.hoisted(() => ({ push: null }));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  fetchBrowseStatus: vi.fn(async () => ({ enabled: true, available: false, status: 'unavailable' })),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: true,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: (cb) => {
        updates.push = cb;
        return () => { updates.push = null; };
      },
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

vi.mock('./code/codeModeAccess', async (importOriginal) => ({
  ...(await importOriginal()),
  useCodeModeAccess: () => ({ available: false, enabled: false, state: 'disabled', setEnabled: () => {} }),
}));
vi.mock('./code/CodeView', () => ({ default: () => null }));
vi.mock('./code/useCodeModeLifecycle', () => ({ useCodeModeLifecycle: () => {} }));

import App from './App';
import { fetchSettings } from './api';
import { useNativeOverlayOpen } from './lib/nativeOverlay';

/* What the desktop browser stage reads: whether any overlay is open. */
function OverlayProbe() {
  return <output data-testid="overlay">{useNativeOverlayOpen() ? 'open' : 'clear'}</output>;
}

const width = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  localStorage.clear();
});

async function renderApp(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
  render(<><App /><OverlayProbe /></>);
  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  await act(async () => {});
}

describe('App overlays over the desktop browser pane', () => {
  it('counts the narrow-band sidebar popout while it is open', async () => {
    const user = userEvent.setup();
    await renderApp(800);
    expect(screen.getByTestId('overlay')).toHaveTextContent('clear');
    await user.click(await screen.findByRole('button', { name: 'Open sidebar' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('open');
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('overlay')).toHaveTextContent('clear');
  });

  it('counts the update curtain while an update downloads and the UI reloads', async () => {
    await renderApp(1400);
    expect(screen.getByTestId('overlay')).toHaveTextContent('clear');
    act(() => updates.push({ phase: 'downloading', version: '2026.11.07' }));
    expect(screen.getByText('Updating to 2026.11.07...')).toBeInTheDocument();
    expect(screen.getByTestId('overlay')).toHaveTextContent('open');
    act(() => updates.push({ phase: 'reloading', version: '2026.11.07' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('open');
    act(() => updates.push({ phase: 'error', version: '2026.11.07' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('clear');
  });
});
