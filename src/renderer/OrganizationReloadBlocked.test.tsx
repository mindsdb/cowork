import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetOrganizationTransitionForTests,
  prepareForOrganizationReload,
} from './cowork/lib/organizationTransition';
import { OrganizationReloadBlocked } from './OrganizationReloadBlocked';

vi.mock('./cowork/lib/settingsCache', () => ({ clearCachedSettings: vi.fn() }));
vi.mock('./cowork/lib/draftStore', () => ({ clearDraftsForOrganizationSwitch: vi.fn() }));

const RELOAD_BUDGET_KEY = 'anton.organizationReloadBudget';

/** Spend the whole budget the way three back-to-back documents would. */
function spendReloadBudget() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    prepareForOrganizationReload({ clearTenantState: false });
    const budget = sessionStorage.getItem(RELOAD_BUDGET_KEY);
    __resetOrganizationTransitionForTests();
    if (budget !== null) sessionStorage.setItem(RELOAD_BUDGET_KEY, budget);
  }
}

describe('OrganizationReloadBlocked', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetOrganizationTransitionForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    reloadSpy = vi.fn();
    Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
  });

  afterEach(() => {
    __resetOrganizationTransitionForTests();
    vi.restoreAllMocks();
  });

  it('renders nothing while reloads are still allowed', () => {
    const { container } = render(<OrganizationReloadBlocked />);
    expect(container.textContent).toBe('');
  });

  it('appears when the budget runs out after mount, and its button reloads', async () => {
    spendReloadBudget();
    const { container } = render(<OrganizationReloadBlocked />);
    expect(container.textContent).toBe('');

    act(() => { prepareForOrganizationReload({ clearTenantState: false }); });

    expect(container.textContent).toContain('Your organization changed');
    const reloadsBeforeClick = reloadSpy.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloadSpy).toHaveBeenCalledTimes(reloadsBeforeClick + 1);
  });

  // The module's startup check can spend the budget before React mounts.
  it('appears when the budget ran out before mount', () => {
    spendReloadBudget();
    prepareForOrganizationReload({ clearTenantState: false });

    const { container } = render(<OrganizationReloadBlocked />);

    expect(container.textContent).toContain('Your organization changed');
  });
});
