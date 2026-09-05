import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Spies we assert on must be referenceable inside the hoisted vi.mock factory.
const spies = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => null),
}));

// Stub mount dependencies to isolate mobile navigation and section-driven loading.
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
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
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

const NAV_LABELS = ['Agent', 'Appearance', 'Channels', 'Updates', 'Backend', 'Account'];

// The parent controls the section for both rendering and effects; null shows the list.
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
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();
    for (const label of NAV_LABELS) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it('drills into a section on tap and back returns to the list', () => {
    renderMobile();
    fireEvent.click(screen.getByRole('button', { name: /^Account$/ }));
    expect(screen.getByRole('button', { name: 'Back to settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Appearance$/ })).toBeNull();
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

  // A targeted open must show the requested section immediately.
  it('opens directly on a deep-linked section', () => {
    renderMobile({ initialSection: 'account' });
    expect(screen.getByRole('button', { name: 'Back to settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Appearance$/ })).toBeNull();
  });

  // Mobile navigation must update the same section used by loading effects.
  it('fires the section-keyed load effect for the open section', async () => {
    renderMobile({ initialSection: 'account' });
    await waitFor(() => expect(spies.getAccessToken).toHaveBeenCalled());
  });
});
