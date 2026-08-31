import { beforeEach, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_TRANSITION_STORAGE_KEY,
  currentOrganizationEpoch,
  organizationEpochForTransition,
  parseOrganizationTransition,
  storageKeyForOrganizationEpoch,
} from './organizationTransitionState';

beforeEach(() => localStorage.clear());

describe('organizationTransitionState', () => {
  it('uses a committed transition id as the cache epoch', () => {
    const marker = {
      version: 1,
      id: 'current-transition',
      phase: 'reload',
      subject: 'user-1',
      startedAt: 123,
    };
    localStorage.setItem(ORGANIZATION_TRANSITION_STORAGE_KEY, JSON.stringify(marker));

    expect(parseOrganizationTransition(JSON.stringify(marker))).toMatchObject(marker);
    expect(currentOrganizationEpoch()).toBe('current-transition');
  });

  it('keeps the previous committed epoch while a switch is pending', () => {
    const marker = parseOrganizationTransition(JSON.stringify({
      version: 1,
      id: 'pending-transition',
      phase: 'pending',
      subject: 'user-1',
      startedAt: 456,
      previousReload: {
        id: 'previous-transition',
        subject: 'user-1',
        startedAt: 123,
      },
    }));

    expect(organizationEpochForTransition(marker)).toBe('previous-transition');
  });

  it('fails closed to the initial epoch for malformed storage', () => {
    localStorage.setItem(ORGANIZATION_TRANSITION_STORAGE_KEY, '{not json');

    expect(currentOrganizationEpoch()).toBeNull();
    expect(parseOrganizationTransition(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseOrganizationTransition(JSON.stringify({
      version: 1,
      id: '\ud800',
      phase: 'reload',
      startedAt: 123,
    }))).toBeNull();
  });

  it('uses a distinct storage key for each committed epoch', () => {
    expect(storageKeyForOrganizationEpoch('anton.cache', null)).toBe('anton.cache');
    expect(storageKeyForOrganizationEpoch('anton.cache', 'org/one'))
      .toBe('anton.cache:organization:org%2Fone');
  });
});
