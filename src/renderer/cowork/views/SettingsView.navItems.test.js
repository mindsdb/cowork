import { describe, it, expect, vi } from 'vitest';

// Importing SettingsView pulls in the whole settings surface — `api.js` calls
// `host.getApiOrigin()` at module scope — so the API and platform bridge are
// stubbed the same way the sibling SettingsView tests do. Only the nav-filter
// decision is under test. `navItemsForHost` takes `isWeb` as an argument rather
// than reading `host` itself, precisely so it can be tested directly without
// re-mocking the module per case.
vi.mock('../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
  fetchRecommendedModels: vi.fn(async () => ({})),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: false,
    isElectron: true,
    isMac: () => false,
    getApiOrigin: () => 'http://127.0.0.1:26866',
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
  },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));

import { navItemsForHost } from './SettingsView';

const ids = (items) => items.map((i) => i.id);

describe('navItemsForHost — which Settings sections a host offers (ENG-932)', () => {
  it('gives Electron every section', () => {
    expect(ids(navItemsForHost(false))).toEqual([
      'agent', 'appearance', 'channels', 'updates', 'backend', 'account',
    ]);
  });

  it('gives web exactly Agent, Appearance, Channels', () => {
    expect(ids(navItemsForHost(true))).toEqual(['agent', 'appearance', 'channels']);
  });

  it('keeps Agent on web — it carries the reasoning-effort control', () => {
    // The whole point of the ticket: reasoning effort is the only user-side
    // workaround for a turn that spends its entire output budget on internal
    // reasoning and returns nothing (ENG-1042). If Agent ever drops off the
    // web nav, hosted users lose their only recourse again.
    expect(ids(navItemsForHost(true))).toContain('agent');
  });

  it('omits the three sections web cannot act on', () => {
    const web = ids(navItemsForHost(true));
    // backend — start/stop/diagnostics of a server the user doesn't control.
    // updates — App-shell version / OTA source are meaningless on hosted.
    // account — a second sign-in surface for an already-authenticated user.
    expect(web).not.toContain('backend');
    expect(web).not.toContain('updates');
    expect(web).not.toContain('account');
  });

  it('omits rather than disables — a row that opens a dead end is worse', () => {
    // Pins the intent from the ticket: absent, not present-and-inert. The old
    // renderBackendSection web branch rendered a "managed server-side" panel,
    // which is a dead end the user had to discover by clicking.
    expect(navItemsForHost(true).some((i) => i.id === 'backend')).toBe(false);
  });

  it('preserves each section\'s label and icon, and the desktop ordering', () => {
    const web = navItemsForHost(true);
    expect(web.map((i) => i.label)).toEqual(['Agent', 'Appearance', 'Channels']);
    expect(web.every((i) => typeof i.icon === 'string' && i.icon.length > 0)).toBe(true);
    // Filtered, not reordered — web order must be a subsequence of desktop's.
    const desktop = ids(navItemsForHost(false));
    expect(ids(web)).toEqual(desktop.filter((id) => ids(web).includes(id)));
  });

  it('does not hand out the shared array for callers to mutate', () => {
    const a = navItemsForHost(true);
    a.pop();
    expect(ids(navItemsForHost(true))).toEqual(['agent', 'appearance', 'channels']);
  });
});
