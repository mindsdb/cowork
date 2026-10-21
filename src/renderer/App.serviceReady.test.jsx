import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  checkConfigured: vi.fn(),
  readSettings: vi.fn(),
  saveSettings: vi.fn(),
  setOrgMode: vi.fn(),
  syncSettingsToDb: vi.fn(),
  onboarding: vi.fn(() => <div>Provider onboarding</div>),
}));

vi.mock('./lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('./platform/host', () => ({ host: {
  isWeb: true,
  isMac: () => false,
  checkConfigured: mocks.checkConfigured,
  readSettings: mocks.readSettings,
  saveSettings: mocks.saveSettings,
  getShellSupport: async () => null,
  watchUpdateState: () => () => {},
  accountOwnershipPending: async () => null,
} }));
vi.mock('./lib/orgMode', () => ({ setOrgMode: mocks.setOrgMode }));
vi.mock('./lib/syncSettings', () => ({
  syncSettingsToDb: mocks.syncSettingsToDb,
  syncModelsToDbWithRetry: vi.fn(),
}));
vi.mock('./lib/keycloak', () => { throw new Error('Service readiness must not read platform registration'); });
vi.mock('./cowork/lib/analytics', () => ({
  trackBootScreenResolved: vi.fn(),
  trackShellUpdatePhase: vi.fn(),
  drainUpdateJournal: vi.fn(),
}));
vi.mock('./pages/arcade/OnboardingScreen', () => ({ default: mocks.onboarding }));
vi.mock('./pages/arcade/SetupScreen', () => ({ default: () => <div>Installer</div> }));
vi.mock('./CoworkApp', () => ({ default: () => <div>Workspace ready</div> }));
vi.mock('./RestartConfirmHost', () => ({ default: () => null }));
vi.mock('./cowork/components/AccountOwnershipModal', () => ({ default: () => null }));
vi.mock('./WelcomeLoading', () => ({
  WelcomeLoading: () => <div>Loading</div>,
  applyArcadePreset: vi.fn(),
}));
vi.mock('./cowork/components/ui/OrbitMorph', () => ({ default: () => null }));

import App from './App';

function expectNoProviderSetup() {
  expect(mocks.onboarding).not.toHaveBeenCalled();
  expect(mocks.readSettings).not.toHaveBeenCalled();
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  expect(mocks.syncSettingsToDb).not.toHaveBeenCalled();
  expect(localStorage.getItem('anton.termsConsent')).toBeNull();
  expect(screen.queryByText('Installer')).not.toBeInTheDocument();
  expect(document.querySelectorAll('a, input[type=password]')).toHaveLength(0);
}

describe('service readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.checkConfigured.mockReset();
  });

  it.each([false, true])('opens a configured service without provider or consent setup (org=%s)', async (orgMode) => {
    mocks.checkConfigured.mockResolvedValue({ configured: true, orgMode });
    render(<App />);
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument();
    expect(mocks.setOrgMode).toHaveBeenCalledWith(orgMode);
    expectNoProviderSetup();
  });

  it('offers a retry after a failed health read and enters when the service recovers', async () => {
    mocks.checkConfigured.mockRejectedValueOnce(new Error('Restarting'))
      .mockResolvedValue({ configured: true, orgMode: false });
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent('The service is unavailable');
    expect(mocks.setOrgMode).toHaveBeenCalledWith(true);
    expectNoProviderSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument();
    expect(mocks.setOrgMode).toHaveBeenLastCalledWith(false);
    expectNoProviderSetup();
  });

  it('keeps an unconfigured service retryable without saving defaults', async () => {
    mocks.checkConfigured.mockResolvedValue({ configured: false, orgMode: false });
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent('The service is not configured yet');
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.checkConfigured).toHaveBeenCalledTimes(2));
    expectNoProviderSetup();
    mocks.checkConfigured.mockResolvedValue({ configured: true, orgMode: false });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument();
    expectNoProviderSetup();
  });
});
