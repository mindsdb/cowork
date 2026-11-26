import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({ host: { openExternal: vi.fn() } }));
vi.mock('../../platform/host', () => hostMock);
const analyticsMock = vi.hoisted(() => ({ trackUpgradeClicked: vi.fn() }));
vi.mock('../lib/analytics', () => analyticsMock);
vi.mock('./useAccountUser', () => ({ useAccountUser: () => ({ orgIsPersonal: true, orgId: 'org-1', sub: 'u-1' }) }));

import { useUpgradeOffer, useUsageActions } from './useUpgradeOffer';
import { HubUsageContext } from '../lib/hubUsageContext';
import { upgradeAction } from '../lib/usageWarnings';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';

const usage = {
  reachable: true,
  isBillingOwner: true,
  freeTokens: null,
  balance: { usd: 0, canConsume: false, alert: 'depleted' },
  autoTopUp: { enabled: false, status: 'ok' },
  plan: { tier: 'plus', status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows: [] },
};
const wrapper = ({ children }) => (
  <HubUsageContext.Provider value={{ usage, providerType: 'minds-cloud' }}>{children}</HubUsageContext.Provider>
);
const opened = () => new URL(hostMock.host.openExternal.mock.calls.at(-1)[0]);

beforeEach(() => {
  hostMock.host.openExternal.mockClear();
  analyticsMock.trackUpgradeClicked.mockClear();
});

describe('useUpgradeOffer', () => {
  it('opens the plan confirm with the placement as its start surface, and records the same placement', () => {
    const { result } = renderHook(() => useUpgradeOffer(), { wrapper });

    result.current.open('pro', 'usage_settings');

    expect(analyticsMock.trackUpgradeClicked).toHaveBeenCalledWith('usage_settings', 'pro', 'plus');
    const url = opened();
    expect(url.searchParams.get('start_surface')).toBe('cowork_usage_settings');
    expect(url.searchParams.get('upgrade')).toBe('pro');
    expect(url.searchParams.get('organization')).toBe('org-1');
    expect(url.searchParams.get('subject')).toBe('u-1');
  });

  it('names no start surface when the caller names no placement', () => {
    const { result } = renderHook(() => useUpgradeOffer(), { wrapper });

    result.current.open('pro');

    expect(analyticsMock.trackUpgradeClicked).toHaveBeenCalledWith(undefined, 'pro', 'plus');
    expect(opened().searchParams.has('start_surface')).toBe(false);
    expect(opened().searchParams.get('upgrade')).toBe('pro');
  });

  it('builds the same link from urlFor, with and without a placement', () => {
    const { result } = renderHook(() => useUpgradeOffer(), { wrapper });

    expect(new URL(result.current.urlFor('pro', 'model_card')).searchParams.get('start_surface')).toBe('cowork_model_card');
    expect(new URL(result.current.urlFor('pro')).searchParams.has('start_surface')).toBe(false);
  });

  it('keeps the Manage link bare of any start surface', () => {
    const { result } = renderHook(() => useUpgradeOffer(), { wrapper });

    const manage = new URL(result.current.manageUrl);
    expect(`${manage.origin}${manage.pathname}`).toBe(MINDS_BILLING_URL);
    expect(manage.searchParams.has('start_surface')).toBe(false);
    expect(manage.searchParams.get('organization')).toBe('org-1');
  });
});

describe('useUsageActions', () => {
  it('opens an upgrade action with the placement as its start surface', () => {
    const { result } = renderHook(() => useUsageActions(), { wrapper });

    result.current.openUpgrade(upgradeAction('pro'), 'usage_bar');

    expect(analyticsMock.trackUpgradeClicked).toHaveBeenCalledWith('usage_bar', 'pro', 'plus');
    expect(opened().searchParams.get('start_surface')).toBe('cowork_usage_bar');
  });
});
