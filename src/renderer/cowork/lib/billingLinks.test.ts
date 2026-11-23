import { afterEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({ host: { isMobileShell: false } }));
vi.mock('../../platform/host', () => hostMock);

import { billingActions, offersBilling } from './billingLinks';

afterEach(() => { hostMock.host.isMobileShell = false; });

describe('billing links', () => {
  it('are offered in a browser and the desktop app', () => {
    expect(offersBilling()).toBe(true);
    expect(billingActions(['addFunds', 'viewUsage'])).toEqual(['addFunds', 'viewUsage']);
  });

  it('are never offered inside the mobile app', () => {
    hostMock.host.isMobileShell = true;
    expect(offersBilling()).toBe(false);
    expect(billingActions(['addFunds', 'viewUsage'])).toEqual([]);
  });

  it('treat a missing list as empty', () => {
    expect(billingActions(undefined)).toEqual([]);
    expect(billingActions(null)).toEqual([]);
  });

  it('return a copy, so a caller cannot change the list it was given', () => {
    const actions = ['addFunds'];
    const shown = billingActions(actions);
    shown.push('viewUsage');
    expect(actions).toEqual(['addFunds']);
  });
});
