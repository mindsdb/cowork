import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ENG-1206 regression: signing out must never leave the confirm modal stuck on
// "Signing out…". On Electron SUCCESS the main process drives the reload that
// unmounts the modal, so the renderer must NOT also reload (the two race). But
// if host.logout() REJECTS, main threw before it could drive that reload — and
// since the main handler clears tokens + the server DB early, the user IS
// signed out, so the renderer reloads itself to re-route to onboarding rather
// than trapping the spinner or showing a misleading "try again".

// A decodable JWT so the Account section renders the signed-in card (and thus
// the "Sign out" button) rather than the sign-in card.
const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

const spies = vi.hoisted(() => ({
  logout: vi.fn(),
  getAccessToken: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));

vi.mock('../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => false,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    logout: spies.logout,
  },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: spies.resetDeviceIdentity,
}));
vi.mock('./ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

let reloadSpy;

function renderAccount() {
  return render(
    <SettingsView
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
      section="account"
      onSectionChange={vi.fn()}
    />,
  );
}

// Open the "Sign out of Cowork?" confirm dialog and return it.
async function openConfirm() {
  renderAccount();
  // The signed-in card (and its Sign out button) only render once the token
  // resolves into accountUser. Before the modal opens this is the only
  // "Sign out" button on screen.
  const cardButton = await screen.findByRole('button', { name: 'Sign out' });
  fireEvent.click(cardButton);
  // ConfirmModal renders via Base UI's Dialog (role="dialog"), portaled and
  // mounted asynchronously — wait for it.
  return screen.findByRole('dialog');
}

describe('SettingsView sign-out (ENG-1206)', () => {
  beforeEach(() => {
    spies.logout.mockReset();
    spies.resetDeviceIdentity.mockReset();
    spies.getAccessToken.mockReset();
    spies.getAccessToken.mockResolvedValue(jwt({ name: 'Ada Lovelace', email: 'ada@example.com' }));
    // Intercept the hard reload so the jsdom/happy-dom environment survives.
    reloadSpy = vi.fn();
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
  });

  it('reloads to re-route to onboarding when host.logout() rejects on Electron', async () => {
    spies.logout.mockRejectedValue(new Error('EPERM: operation not permitted, open .env'));

    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    // Rejection ⇒ main never drove its reload, but the user is signed out, so
    // the renderer reloads itself (unmounting the modal in production). It must
    // NOT rotate the analytics identity on a failed attempt (ENG-537).
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(spies.logout).toHaveBeenCalledTimes(1);
    expect(spies.resetDeviceIdentity).not.toHaveBeenCalled();
  });

  it('rotates identity and lets the main process drive the reload on success', async () => {
    spies.logout.mockResolvedValue(undefined);

    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    // On Electron SUCCESS the renderer must NOT reload itself (that races the
    // main-driven webContents.reload() and re-sticks the modal) — it stays busy
    // until main unmounts it. It DOES rotate the device identity once.
    await waitFor(() => expect(spies.resetDeviceIdentity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(dialog).getByText('Signing out…')).toBeTruthy());
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
