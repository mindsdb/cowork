// ENG-4186: rows outside the plan offer Upgrade beside Add credits, and on a
// paid plan an open row names the plan that covers it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostSpies = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, openExternal: hostSpies.openExternal } };
});
const analyticsSpies = vi.hoisted(() => ({ trackBillingOpened: vi.fn(), trackUpgradeClicked: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => ({ ...(await importOriginal()), ...analyticsSpies }));
const account = vi.hoisted(() => ({ current: { orgIsPersonal: true, orgId: 'org-1', sub: 'u-1' } }));
vi.mock('../hooks/useAccountUser', () => ({ useAccountUser: () => account.current }));

import { ModelSelect } from './ModelSelect';
import { HubUsageContext } from '../lib/hubUsageContext';
import { buildModelPickerOptions } from '../lib/modelPickerOptions';

const MODELS = [
  { id: 'mindshub_air', name: 'MindsHub Air' },
  { id: 'glm-5.3', name: 'GLM 5.3' },
  { id: 'opus', name: 'Claude Opus 5.5' },
];
const META = {
  modelEnabled: { mindshub_air: true, 'glm-5.3': true, opus: false },
  modelDisabledReasons: { opus: 'model_not_in_tier' },
  modelCoveredByTier: { mindshub_air: 'free', 'glm-5.3': 'plus', opus: 'pro' },
};
const plan = (tier) => ({ tier, status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows: [] });

const open = async (planValue) => {
  const usage = { reachable: true, isBillingOwner: true, plan: planValue };
  render(
    <HubUsageContext.Provider value={{ usage, providerType: 'minds-cloud' }}>
      <ModelSelect value="mindshub_air" onValueChange={vi.fn()} options={buildModelPickerOptions(MODELS, META)} />
    </HubUsageContext.Provider>,
  );
  await userEvent.click(screen.getByRole('combobox'));
  return screen.findByRole('option', { name: /Claude Opus 5\.5/ });
};

beforeEach(() => {
  account.current = { orgIsPersonal: true, orgId: 'org-1', sub: 'u-1' };
  hostSpies.openExternal.mockClear();
  analyticsSpies.trackUpgradeClicked.mockClear();
});

describe('ModelSelect on a plan', () => {
  it('a row outside the plan says which tier covers it, with Upgrade and Add credits', async () => {
    const row = await open(plan('plus'));
    expect(within(row).getByText('Needs Pro')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Add credits' })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Upgrade' }));
    expect(new URL(hostSpies.openExternal.mock.calls.at(-1)[0]).searchParams.get('upgrade')).toBe('pro');
    expect(analyticsSpies.trackUpgradeClicked).toHaveBeenCalledWith('model_picker', 'pro', 'plus');
  });

  it('on Plus, an open covered row names its plan; a free-tier row stays bare', async () => {
    await open(plan('plus'));
    expect(within(screen.getByRole('option', { name: /GLM 5\.3/ })).getByText('Plus')).toBeInTheDocument();
    expect(within(screen.getByRole('option', { name: /MindsHub Air/ })).queryByText(/Plus|Pro|Free/)).toBeNull();
  });

  it('on Free, shows no plan tags; with no plan, no Upgrade either', async () => {
    const row = await open(null);
    expect(within(row).queryByRole('button', { name: 'Upgrade' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Add credits' })).toBeInTheDocument();
    expect(within(screen.getByRole('option', { name: /GLM 5\.3/ })).queryByText('Plus')).toBeNull();
  });
});
