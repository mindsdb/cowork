/* The Settings > Agent notice after a failed MindsHub health probe follows the
   sidecar's `providerStatusReasons`, not a substring of the detail string.
   Every MindsHub 429 used to read "No credits available": a velocity limit, a
   spent free allowance and the daily free-Air fuse alike. The legacy detail
   check still applies when the sidecar sends no reasons map at all, which
   SettingsView.billingOpened.test.jsx pins unmodified. A sidecar that sends
   the map and names no reason for a type gets no billing notice. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const spies = vi.hoisted(() => ({ testProviders: vi.fn(async () => ({})) }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: spies.testProviders,
}));

const hostMock = vi.hoisted(() => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../../platform/host', () => hostMock);

const analyticsMock = vi.hoisted(() => ({
  resetDeviceIdentity: vi.fn(),
  trackBillingOpened: vi.fn(),
}));
vi.mock('../../lib/analytics', () => analyticsMock);
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { HubUsageContext } from '../../lib/hubUsageContext';
import { formatResetTime, NO_FREE_GRANT_SENTENCE } from '../../lib/usageWarnings';
import { MINDS_BILLING_URL } from '../../../lib/mindsUrls';

function Harness({ initialSettings, usage = null }) {
  const [settings, setSettings] = useState(initialSettings);
  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const view = (
    <SettingsView
      settings={settings}
      setSetting={setSetting}
      onSave={vi.fn(async () => {})}
      theme="dark"
      onThemeChange={vi.fn()}
      skin="default"
      onSkinChange={vi.fn()}
      customTheme={{}}
      onCustomThemeChange={vi.fn()}
      agentLabel="Anton"
      serverOnline
      section="agent"
      onSectionChange={vi.fn()}
    />
  );
  if (!usage) return view;
  return (
    <HubUsageContext.Provider value={{ usage, providerType: 'minds-cloud', refresh: () => {} }}>
      {view}
    </HubUsageContext.Provider>
  );
}

const baseSettings = () => ({
  modelMode: 'default',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
  recommendedModels: { 'minds-cloud': ['gpt-5.6-sol', 'air'] },
  planningProvider: 'minds-cloud',
  planningModel: 'gpt-5.6-sol',
});

/* A failed MindsHub probe as the sidecar reports it: the detail string it has
   always sent, plus the reason when it can name one. */
const probeFailure = (detail, reason) => ({
  providerStatus: { 'minds-cloud': 'fail' },
  providerStatusDetails: { 'minds-cloud': detail },
  ...(reason ? { providerStatusReasons: { 'minds-cloud': reason } } : {}),
});

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const hubUsage = (freeTokens) => ({
  reachable: true,
  isBillingOwner: false,
  freeTokens,
  balance: { usd: 0, canConsume: false, hasToppedUp: false, alert: 'depleted' },
  autoTopUp: { enabled: false, thresholdUsd: null, rechargeToUsd: null, status: 'ok' },
});

beforeEach(() => {
  analyticsMock.trackBillingOpened.mockClear();
  hostMock.host.openExternal.mockClear();
  spies.testProviders.mockReset().mockResolvedValue({});
});

describe('SettingsView: probe notice follows the sidecar reason', () => {
  it('a velocity 429 says slow down, never "No credits", and offers no billing action', async () => {
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 429: Too Many Requests', { code: 'rate_limited', resetAt: null }));
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getAllByText(/Too many requests too quickly\. Wait a moment, then test again\./).length).toBeGreaterThan(0));
    expect(screen.queryByText(/No credits available/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Top up balance/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add funds/ })).toBeNull();
    // The notice replaces the generic warning; it is not a broken provider.
    expect(screen.queryByText(/failed its last test/)).toBeNull();
  });

  it('the daily fuse says free Air is paused until it lifts, and Add funds records its own trigger', async () => {
    const user = userEvent.setup();
    const lifts = inHours(6);
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 429', { code: 'free_air_daily_spend_fuse_exceeded', resetAt: lifts }));
    render(<Harness initialSettings={baseSettings()} />);

    const copy = `Free MindsHub Air is paused for everyone until ${formatResetTime(lifts)}. This doesn't use your allowance. Add funds to keep working now.`;
    await waitFor(() => expect(screen.getAllByText(copy).length).toBeGreaterThan(0));
    expect(screen.queryByText(/No credits available/i)).toBeNull();
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled(); // render is not a click

    await user.click(screen.getAllByRole('button', { name: /Add funds/ })[0]);

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('free_air_paused_notice');
    // Not the billing owner, so the funds action opens the billing page itself.
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('a spent allowance names the refill time the gate sent when the org has a grant', async () => {
    const user = userEvent.setup();
    const refill = inHours(2);
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 429', { code: 'included_allowance_exhausted', resetAt: refill }));
    render(<Harness
      initialSettings={baseSettings()}
      usage={hubUsage({ limit: 100, used: 100, remaining: 0, resetsAt: refill })}
    />);

    const copy = `Your free MindsHub Air allowance is used up and your balance is empty. Add funds to keep working, or wait for it to refill at ${formatResetTime(refill)}.`;
    await waitFor(() => expect(screen.getAllByText(copy).length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole('button', { name: /Add funds/ })[0]);
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('allowance_used_notice');
  });

  it('a spent allowance on an org with no free grant says so and names no refill', async () => {
    /* Auth still sends a reset instant to a no-grant org until its gate change
       ships. Nothing refills there, so the notice must not repeat it. */
    const fromGate = inHours(2);
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 429', { code: 'included_allowance_exhausted', resetAt: fromGate }));
    render(<Harness
      initialSettings={baseSettings()}
      usage={hubUsage({ limit: 0, used: 0, remaining: 0, resetsAt: null })}
    />);

    await waitFor(() => expect(screen.getAllByText(`${NO_FREE_GRANT_SENTENCE} Your balance is empty, so add funds to continue.`).length).toBeGreaterThan(0));
    expect(screen.queryByText(/refill/i)).toBeNull();
  });

  it('a billing outage says billing is unavailable, not that MindsHub failed its test', async () => {
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 503', { code: 'policy_unavailable', resetAt: null }));
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getAllByText('Billing is temporarily unavailable. Try again in a moment.').length).toBeGreaterThan(0));
    expect(screen.queryByText(/failed its last test/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Add funds|Top up/ })).toBeNull();
  });

  it('a wallet_empty reason keeps the no-credits notice and its trigger', async () => {
    const user = userEvent.setup();
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 402', { code: 'wallet_empty', resetAt: null }));
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getAllByText(/No credits available/).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /Top up balance/ })[0]);
    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('no_credits_notice');
  });

  it('a re-test that fails with no reason drops the earlier reason, so no stale "paused" remains', async () => {
    const user = userEvent.setup();
    spies.testProviders
      .mockResolvedValueOnce(probeFailure('HTTP 429', { code: 'free_air_daily_spend_fuse_exceeded', resetAt: inHours(6) }))
      .mockResolvedValue(probeFailure('HTTP 500: upstream error'));
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getAllByText(/Free MindsHub Air is paused for everyone/).length).toBeGreaterThan(0));

    // Save re-tests a failed provider.
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(spies.testProviders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(/MindsHub failed its last test/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Free MindsHub Air is paused/)).toBeNull();
  });

  it('a 429 the sidecar classified with no MindsHub reason gets the generic warning, never "No credits"', async () => {
    /* mindshub_inference relays an upstream vendor's 429 with no
       X-MindsHub-Reason, so the sidecar names no reason and sends an empty
       map. The legacy detail check would read that "HTTP 429" as an empty
       wallet. */
    spies.testProviders.mockResolvedValue({
      providerStatus: { 'minds-cloud': 'fail' },
      providerStatusDetails: { 'minds-cloud': 'HTTP 429: rate_limit_error from upstream' },
      providerStatusReasons: {},
    });
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getAllByText(/MindsHub failed its last test/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/No credits available/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Top up balance/ })).toBeNull();
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });

  it('a re-test the sidecar classified with no reason drops an earlier reason and reads no credits nowhere', async () => {
    const user = userEvent.setup();
    spies.testProviders
      .mockResolvedValueOnce(probeFailure('HTTP 429', { code: 'free_air_daily_spend_fuse_exceeded', resetAt: inHours(6) }))
      .mockResolvedValue({
        providerStatus: { 'minds-cloud': 'fail' },
        providerStatusDetails: { 'minds-cloud': 'HTTP 429: rate_limit_error from upstream' },
        providerStatusReasons: {},
      });
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getAllByText(/Free MindsHub Air is paused for everyone/).length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(spies.testProviders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(/MindsHub failed its last test/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Free MindsHub Air is paused/)).toBeNull();
    expect(screen.queryByText(/No credits available/i)).toBeNull();
  });

  it("names the stop on the LLM Providers row instead of calling every 429 'Rate limited'", async () => {
    spies.testProviders.mockResolvedValue(probeFailure('HTTP 429', { code: 'free_air_daily_spend_fuse_exceeded', resetAt: inHours(6) }));
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(screen.getByText('Free MindsHub Air is paused right now.')).toBeInTheDocument());
    expect(screen.queryByText(/Rate limited/)).toBeNull();
  });

  it('keeps Save at "Saved" when a passing test writes the reasons map, which is never a user edit', async () => {
    /* A first paint from settings cached by an older renderer carries no
       providerStatusReasons key; the mount test adds one. That must not read
       as an unsaved change. */
    spies.testProviders.mockResolvedValue({
      providerStatus: { 'minds-cloud': 'ok' },
      providerStatusDetails: { 'minds-cloud': '' },
      providerStatusReasons: {},
    });
    render(<Harness initialSettings={baseSettings()} />);

    await waitFor(() => expect(spies.testProviders).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /Saved/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
  });
});
