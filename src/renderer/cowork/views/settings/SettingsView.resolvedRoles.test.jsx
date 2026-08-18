import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// ENG-1632 behavior lock for the default-mode save path (withResolvedRoles).
//
// The old behavior wrote the raw recommended pair whenever a role's stored
// provider differed from the default-mode provider. Because the server
// serializes a pydantic default (anthropic) for a role with NO stored row —
// and sign-in never wrote router_provider — that guard was permanently true,
// so every default-mode save materialized coding_model='haiku' /
// router_model='kimi' as explicit rows. The write survived the save diff
// exactly for wallet-locked accounts (funded accounts' fetched values already
// matched the pair), pinning unaffordable models on precisely the users who
// could not pay for them: the completion verifier then 402'd every turn,
// surfaced as a spurious "internal error".
//
// Locked now: a default-mode save (1) repoints the providers and (2)
// TOMBSTONES all three role models — planning included (null → DELETE, so the
// server's enabled-aware default governs). No model value is ever invented
// client-side in default mode: a written row is indistinguishable from a real
// user pick, so even an "affordable" seed would freeze (a topped-up account
// would stay stranded on the free model — ENG-597's spring-back). The picker
// stays honest because GET /settings returns the server-computed value for
// unset fields (pnewsam review on #663).

const spies = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => ''),
  getVersionInfo: vi.fn(async () => ({ app: '1.2.3', ui: null, source: 'bundled' })),
}));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
}));
vi.mock('../../../platform/host', () => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: spies.getVersionInfo,
  isElectron: true,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

// A wallet-locked MindsHub account whose role-provider rows carry the server's
// pydantic default (anthropic) — i.e. no user choice was ever stored.
const lockedSettings = () => ({
  modelMode: 'default',
  planningProvider: 'anthropic',
  codingProvider: 'anthropic',
  routerProvider: 'anthropic',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' }],
  providerStatus: { 'minds-cloud': 'ok' },
  providerStatusDetails: {},
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
  recommendedPair: { 'minds-cloud': ['sonnet', 'haiku', 'kimi'] },
  recommendedModels: { 'minds-cloud': ['mindshub_air', 'sonnet', 'haiku', 'kimi'] },
  modelEnabled: { mindshub_air: true, sonnet: false, haiku: false, kimi: false },
});

function Harness({ onSave, initial }) {
  const [settings, setSettings] = useState(initial);
  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  return (
    <>
      {/* The save button only enables once settings drift from the mount
          snapshot — flip a harmless flag the way any real edit would. */}
      <button type="button" onClick={() => setSetting('actFirst', true)}>make-dirty</button>
      <SettingsView
        settings={settings}
        setSetting={setSetting}
        onSave={onSave}
        theme="dark"
        onThemeChange={vi.fn()}
        skin="default"
        onSkinChange={vi.fn()}
        customTheme={{}}
        onCustomThemeChange={vi.fn()}
        agentLabel="Anton"
        serverOnline
        serverBusy={false}
        onStartServer={vi.fn()}
        onStopServer={vi.fn()}
        section="agent"
        onSectionChange={vi.fn()}
        isSsoConnected={false}
        onSsoSignIn={vi.fn()}
        shellUpdate={null}
        onDownloadShellUpdate={vi.fn()}
      />
    </>
  );
}

async function saveAndCapture(initial) {
  const onSave = vi.fn(async () => {});
  const user = userEvent.setup();
  render(<Harness onSave={onSave} initial={initial} />);
  await user.click(screen.getByText('make-dirty'));
  await user.click(await screen.findByRole('button', { name: /save settings/i }));
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0];
}

describe('withResolvedRoles — default-mode save (ENG-1632)', () => {
  it('tombstones the aux models and never writes the raw pair', async () => {
    const saved = await saveAndCapture(lockedSettings());
    // Providers still repoint (keeping another provider's model id would
    // misroute), but no aux model value is invented on the user's behalf.
    expect(saved.codingProvider).toBe('minds-cloud');
    expect(saved.routerProvider).toBe('minds-cloud');
    expect(saved.codingModel).toBeNull();
    expect(saved.routerModel).toBeNull();
    // The exact regression: the raw pair values must never appear.
    expect(saved.codingModel).not.toBe('haiku');
    expect(saved.routerModel).not.toBe('kimi');
  });

  it('tombstones planning too — no model value is invented for any role', async () => {
    const saved = await saveAndCapture(lockedSettings());
    expect(saved.planningProvider).toBe('minds-cloud');
    expect(saved.planningModel).toBeNull();
    expect(saved.defaultModel).toBeNull();
    // The exact regression pnewsam flagged: neither the locked pair head nor
    // a client-derived "affordable" value may be written as an explicit row.
    expect(saved.planningModel).not.toBe('sonnet');
    expect(saved.planningModel).not.toBe('mindshub_air');
  });

  it('tombstones planning regardless of wallet state — the server owns the default', async () => {
    const funded = {
      ...lockedSettings(),
      modelEnabled: { mindshub_air: true, sonnet: true, haiku: true, kimi: true },
    };
    const saved = await saveAndCapture(funded);
    // Funded or locked makes no difference: default mode writes no models.
    // The server's enabled-aware default resolves sonnet for a funded wallet
    // and the free model for a locked one — and keeps adapting (spring-back).
    expect(saved.planningModel).toBeNull();
    expect(saved.codingModel).toBeNull();
    expect(saved.routerModel).toBeNull();
  });

  it('leaves roles alone when their provider already matches', async () => {
    const matching = {
      ...lockedSettings(),
      planningProvider: 'minds-cloud',
      codingProvider: 'minds-cloud',
      routerProvider: 'minds-cloud',
      planningModel: 'mindshub_air',
    };
    const saved = await saveAndCapture(matching);
    expect(saved.planningModel).toBe('mindshub_air');
    expect(saved.codingModel).toBeUndefined();
    expect(saved.routerModel).toBeUndefined();
  });

  it('does not touch roles at all in custom mode', async () => {
    const custom = { ...lockedSettings(), modelMode: 'custom' };
    const saved = await saveAndCapture(custom);
    expect(saved.routerProvider).toBe('anthropic');
    expect(saved.codingModel).toBeUndefined();
    expect(saved.routerModel).toBeUndefined();
  });
});
