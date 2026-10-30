import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  checkConfigured: vi.fn(),
  setOrgMode: vi.fn(),
  setDraftLinks: vi.fn(),
}));

// The cloud web image is built with the platform UI on (Dockerfile.frontend,
// VITE_PLATFORM_UI=true), so it boots through resolveBootTarget, not through
// the service-readiness path.
vi.mock('./lib/deployment', () => ({ PLATFORM_UI: true }));
vi.mock('./platform/host', () => ({ host: {
  isWeb: true,
  isMac: () => false,
  checkConfigured: mocks.checkConfigured,
  readSettings: async () => ({}),
  checkInstall: async () => ({ antonInstalled: true, serverDepsReady: true }),
  awaitBootReady: async () => {},
  getShellSupport: async () => null,
  getShellAutoUpdate: async () => null,
  onShellAutoUpdate: () => () => {},
  onUpdateStatus: () => () => {},
  accountOwnershipPending: async () => null,
} }));
vi.mock('./lib/orgMode', () => ({ setOrgMode: mocks.setOrgMode }));
vi.mock('./lib/draftLinks', () => ({ setDraftLinks: mocks.setDraftLinks }));
vi.mock('./lib/keycloak', () => ({ keycloak: { authenticated: true } }));
vi.mock('./lib/bootWelcome', () => ({
  hasBootedBefore: () => true,
  rememberBooted: () => {},
  welcomeFloorMs: () => 0,
}));
vi.mock('./lib/syncSettings', () => ({ syncSettingsToDb: vi.fn(), syncModelsToDbWithRetry: vi.fn() }));
vi.mock('./cowork/lib/analytics', () => ({
  trackBootScreenResolved: vi.fn(),
  trackShellUpdatePhase: vi.fn(),
  drainUpdateJournal: vi.fn(),
}));
vi.mock('./pages/arcade/OnboardingScreen', () => ({ default: () => <div>Provider onboarding</div> }));
vi.mock('./pages/arcade/SetupScreen', () => ({ default: () => <div>Installer</div> }));
vi.mock('./CoworkApp', () => ({ default: () => <div>Workspace ready</div> }));
vi.mock('./RestartConfirmHost', () => ({ default: () => null }));
vi.mock('./cowork/components/AccountOwnershipModal', () => ({ default: () => null }));
vi.mock('./WelcomeLoading', () => ({ WelcomeLoading: () => <div>Loading</div>, applyArcadePreset: vi.fn() }));
vi.mock('./cowork/components/ui/OrbitMorph', () => ({ default: () => null }));

import App from './App';

describe('platform boot stores the draft-links flag', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    [{ draftLinks: true }, true],
    [{}, false],
  ])('stores what /health reported (%o)', async (flag, stored) => {
    mocks.checkConfigured.mockResolvedValue({ configured: true, provider: 'minds_cloud', orgMode: true, ...flag });
    render(<App />);
    expect(await screen.findByText('Workspace ready')).toBeInTheDocument();
    expect(mocks.setDraftLinks).toHaveBeenLastCalledWith(stored);
  });
});
