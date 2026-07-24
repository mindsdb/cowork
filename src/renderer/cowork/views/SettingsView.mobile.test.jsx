import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Spies we assert on must be referenceable inside the hoisted vi.mock factory.
const spies = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => null),
}));

// SettingsView reaches for the API, the platform host bridge, analytics, and
// the Channels sub-view on mount. Stub them so this stays focused on the
// mobile master-detail shell and its section-driven loading (ENG-990/ENG-991).
vi.mock('../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
  },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('./ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

const NAV_LABELS = ['Agent', 'Appearance', 'Channels', 'Updates', 'Backend', 'Account'];

// Controlled harness: the open section is owned by the parent (App in prod).
// Taps call onSectionChange, which re-renders with the new `section` — the
// single source of truth for both rendering and the section-keyed effects.
// `section` null is the list.
function renderMobile({ initialSection = null, ...props } = {}) {
  function Harness() {
    const [section, setSection] = useState(initialSection);
    return (
      <SettingsView
        mobile
        settings={{}}
        setSetting={vi.fn()}
        onSave={vi.fn()}
        theme="dark"
        onThemeChange={vi.fn()}
        skin="default"
        onSkinChange={vi.fn()}
        customTheme={{}}
        onCustomThemeChange={vi.fn()}
        agentLabel="Anton"
        serverOnline
        section={section}
        onSectionChange={setSection}
        {...props}
      />
    );
  }
  return render(<Harness />);
}

describe('SettingsView mobile master-detail (ENG-990/ENG-991)', () => {
  beforeEach(() => { spies.getAccessToken.mockClear(); });

  it('opens on the section list with all six sections', () => {
    renderMobile();
    // Header title is "Settings", back control closes the surface.
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();
    for (const label of NAV_LABELS) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it('drills into a section on tap and back returns to the list', () => {
    renderMobile();
    fireEvent.click(screen.getByRole('button', { name: /^Account$/ }));
    // Now in the Account detail: the list rows are gone, back control changes.
    expect(screen.getByRole('button', { name: 'Back to settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Appearance$/ })).toBeNull();
    // Back returns to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    expect(screen.getByRole('button', { name: /^Appearance$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();
  });

  it('closes the surface via the back control from the list', () => {
    const onClose = vi.fn();
    renderMobile({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ENG-991: a targeted open (onOpenSettings('account')) lands straight on the
  // section detail rather than the list — the mobile view no longer starts at
  // a null local state that ignored the requested section.
  it('opens directly on a deep-linked section', () => {
    renderMobile({ initialSection: 'account' });
    expect(screen.getByRole('button', { name: 'Back to settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Appearance$/ })).toBeNull();
  });

  // ENG-991: the section-keyed load effects fire on mobile because rendering
  // and effects share one `section` state (previously the effects were keyed
  // to a state the mobile rows never touched, so nothing loaded).
  it('fires the section-keyed load effect for the open section', async () => {
    renderMobile({ initialSection: 'account' });
    await waitFor(() => expect(spies.getAccessToken).toHaveBeenCalled());
  });
});
