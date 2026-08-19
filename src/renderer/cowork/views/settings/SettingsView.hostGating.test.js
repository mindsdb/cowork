import { describe, it, expect, vi } from 'vitest';

// Importing SettingsView pulls in the whole settings surface — `api.js` calls
// `host.getApiOrigin()` at module scope — so the API and platform bridge are
// stubbed the same way the sibling SettingsView tests do. Only the nav-filter
// decision is under test. `navItemsForHost` takes `isWeb` as an argument rather
// than reading `host` itself, precisely so it can be tested directly without
// re-mocking the module per case.
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
  fetchRecommendedModels: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
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
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));

import { navItemsForHost, shouldRevealStoredKey } from './SettingsView';

const ids = (items) => items.map((i) => i.id);

describe('navItemsForHost — which Settings sections a host offers (ENG-932)', () => {
  it('gives Electron every section when Coding Mode options are enabled', () => {
    expect(ids(navItemsForHost(false, true))).toEqual([
      'agent', 'codingMode', 'appearance', 'channels', 'updates', 'backend', 'account',
    ]);
  });

  it('gives web exactly Agent, Appearance, Channels', () => {
    expect(ids(navItemsForHost(true, true))).toEqual(['agent', 'appearance', 'channels']);
  });

  it('keeps Agent on web — it carries the reasoning-effort control', () => {
    // The whole point of the ticket: reasoning effort is the only user-side
    // workaround for a turn that spends its entire output budget on internal
    // reasoning and returns nothing (ENG-1042). If Agent ever drops off the
    // web nav, hosted users lose their only recourse again.
    expect(ids(navItemsForHost(true, true))).toContain('agent');
  });

  it('omits the three sections web cannot act on', () => {
    const web = ids(navItemsForHost(true, true));
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
    expect(navItemsForHost(true, true).some((i) => i.id === 'backend')).toBe(false);
  });

  it('preserves each section\'s label and icon, and the desktop ordering', () => {
    const web = navItemsForHost(true, true);
    expect(web.map((i) => i.label)).toEqual(['Agent', 'Appearance', 'Channels']);
    expect(web.every((i) => typeof i.icon === 'string' && i.icon.length > 0)).toBe(true);
    // Filtered, not reordered — web order must be a subsequence of desktop's.
    const desktop = ids(navItemsForHost(false, true));
    expect(ids(web)).toEqual(desktop.filter((id) => ids(web).includes(id)));
  });

  it('does not hand out the shared array for callers to mutate', () => {
    const a = navItemsForHost(true, true);
    a.pop();
    expect(ids(navItemsForHost(true, true))).toEqual(['agent', 'appearance', 'channels']);
    // Desktop returns a copy too — without the spread it would hand back the
    // module-level NAV_ITEMS itself, and this pop() would corrupt every
    // later call on both platforms.
    const b = navItemsForHost(false, true);
    b.pop();
    expect(ids(navItemsForHost(false, true))).toEqual([
      'agent', 'codingMode', 'appearance', 'channels', 'updates', 'backend', 'account',
    ]);
  });
});

describe('navItemsForHost — Coding Mode parked behind CODING_MODE_OPTIONS_ENABLED', () => {
  it('hides the Coding Mode section on desktop when the flag is off', () => {
    expect(ids(navItemsForHost(false, false))).toEqual([
      'agent', 'appearance', 'channels', 'updates', 'backend', 'account',
    ]);
  });

  it('has no Coding Mode section on web either way — it was never in WEB_NAV_IDS', () => {
    expect(ids(navItemsForHost(true, false))).toEqual(['agent', 'appearance', 'channels']);
    expect(ids(navItemsForHost(true, true))).toEqual(['agent', 'appearance', 'channels']);
  });

  it('treats a falsy flag (undefined, 0, "") the same as explicit false', () => {
    expect(ids(navItemsForHost(false))).not.toContain('codingMode');
    expect(ids(navItemsForHost(false, 0))).not.toContain('codingMode');
    expect(ids(navItemsForHost(false, ''))).not.toContain('codingMode');
  });
});

describe('shouldRevealStoredKey — the key-reveal gate (ENG-932)', () => {
  const base = { isWeb: false, show: false, revealName: 'anthropic', isSentinel: true, alreadyRevealed: false };

  // ── The direction a web-only change is most likely to break silently ──
  it('still reveals on desktop — the pre-existing behaviour must be intact', () => {
    expect(shouldRevealStoredKey(base)).toBe(true);
  });

  it('never reveals on web, whatever else is true', () => {
    // /settings/reveal-key is loopback-only server-side; from a browser it 403s.
    expect(shouldRevealStoredKey({ ...base, isWeb: true })).toBe(false);
  });

  it('web short-circuits even the case that would otherwise fetch', () => {
    // Same inputs, only the platform differs — isolates the gate itself.
    expect(shouldRevealStoredKey({ ...base, isWeb: false })).toBe(true);
    expect(shouldRevealStoredKey({ ...base, isWeb: true })).toBe(false);
  });

  // ── The pre-existing conditions, unchanged by this ticket ──
  it('does not fetch when the field is already showing', () => {
    expect(shouldRevealStoredKey({ ...base, show: true })).toBe(false);
  });

  it('does not fetch without a key name to ask for', () => {
    expect(shouldRevealStoredKey({ ...base, revealName: null })).toBe(false);
    expect(shouldRevealStoredKey({ ...base, revealName: '' })).toBe(false);
  });

  it('does not fetch when the value is a real local edit, not the sentinel', () => {
    // The user typed a key; there is nothing stored to reveal.
    expect(shouldRevealStoredKey({ ...base, isSentinel: false })).toBe(false);
  });

  it('does not re-fetch a key it already holds', () => {
    expect(shouldRevealStoredKey({ ...base, alreadyRevealed: true })).toBe(false);
  });

  it('returns a boolean, never a truthy string', () => {
    // `revealName &&` used to leak the name itself when the other legs passed.
    expect(shouldRevealStoredKey(base)).toBe(true);
    expect(shouldRevealStoredKey({ ...base, revealName: 'minds' })).toBe(true);
  });
});
