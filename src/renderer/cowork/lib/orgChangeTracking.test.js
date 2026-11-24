import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: true }));
const analyticsMock = vi.hoisted(() => ({ trackOrganizationChanged: vi.fn() }));
vi.mock('./analytics', () => analyticsMock);

import { noteOrgSwitchIntent, observeActiveOrg, useOrgChangeTracking } from './orgChangeTracking';

const PERSONAL = { id: 'org-personal', isPersonal: true };
const ACME = { id: 'org-acme', isPersonal: false };
const GLOBEX = { id: 'org-globex', isPersonal: false };

beforeEach(() => {
  localStorage.clear();
  analyticsMock.trackOrganizationChanged.mockClear();
});

describe('observeActiveOrg', () => {
  it('reports nothing the first time this device sees the account', () => {
    expect(observeActiveOrg('user-1', ACME)).toBeNull();
  });

  it('reports nothing while the organization stays the same', () => {
    observeActiveOrg('user-1', ACME);
    expect(observeActiveOrg('user-1', ACME)).toBeNull();
  });

  it('reports a move nothing in this app asked for as made outside it', () => {
    observeActiveOrg('user-1', ACME);
    expect(observeActiveOrg('user-1', PERSONAL)).toEqual({
      fromKind: 'company',
      toKind: 'personal',
      cause: 'outside_app',
    });
  });

  it('names the cause of a move this app asked for', () => {
    observeActiveOrg('user-1', PERSONAL);
    noteOrgSwitchIntent('user-1', ACME.id, 'landing');
    expect(observeActiveOrg('user-1', ACME)).toEqual({
      fromKind: 'personal',
      toKind: 'company',
      cause: 'landing',
    });
  });

  it('reports each move once', () => {
    observeActiveOrg('user-1', ACME);
    observeActiveOrg('user-1', PERSONAL);
    expect(observeActiveOrg('user-1', PERSONAL)).toBeNull();
  });

  it('does not credit a move to an intent for another organization', () => {
    observeActiveOrg('user-1', PERSONAL);
    noteOrgSwitchIntent('user-1', ACME.id, 'menu');
    expect(observeActiveOrg('user-1', GLOBEX)?.cause).toBe('outside_app');
  });

  it('does not credit a later move to a refused switch', () => {
    observeActiveOrg('user-1', PERSONAL);
    noteOrgSwitchIntent('user-1', ACME.id, 'menu');
    // The switch was refused: the next look still finds the personal one.
    expect(observeActiveOrg('user-1', PERSONAL)).toBeNull();
    expect(observeActiveOrg('user-1', ACME)?.cause).toBe('outside_app');
  });

  it('does not credit a move to a stale intent', () => {
    observeActiveOrg('user-1', PERSONAL);
    noteOrgSwitchIntent('user-1', ACME.id, 'menu');
    const later = Date.now() + 10 * 60 * 1000;
    expect(observeActiveOrg('user-1', ACME, later)?.cause).toBe('outside_app');
  });

  it('keeps accounts apart', () => {
    observeActiveOrg('user-1', ACME);
    expect(observeActiveOrg('user-2', PERSONAL)).toBeNull();
  });

  it('waits for an account and an organization', () => {
    expect(observeActiveOrg(null, ACME)).toBeNull();
    expect(observeActiveOrg('user-1', null)).toBeNull();
  });
});

describe('useOrgChangeTracking', () => {
  it('sends the event when the page loads into another organization', () => {
    renderHook(() => useOrgChangeTracking({ sub: 'user-1', activeOrg: ACME }));
    expect(analyticsMock.trackOrganizationChanged).not.toHaveBeenCalled();

    renderHook(() => useOrgChangeTracking({ sub: 'user-1', activeOrg: PERSONAL }));
    expect(analyticsMock.trackOrganizationChanged).toHaveBeenCalledExactlyOnceWith({
      fromKind: 'company',
      toKind: 'personal',
      cause: 'outside_app',
    });
  });
});
