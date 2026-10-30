import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: true }));

import {
  landingSwitchTarget,
  markExplicitOrgChoice,
  pickLandingOrg,
  readLastUsedOrgId,
  useOrgLanding,
} from './orgLanding';

const PERSONAL = { id: 'org-personal', name: 'personal_user-1', isPersonal: true };
const ACME = { id: 'org-acme', name: 'acme', isPersonal: false };
const GLOBEX = { id: 'org-globex', name: 'globex', isPersonal: false };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('pickLandingOrg', () => {
  it('lands nowhere without organizations', () => {
    expect(pickLandingOrg([], {})).toBeNull();
    expect(pickLandingOrg(undefined)).toBeNull();
  });

  it('lands nowhere for someone with only a personal organization', () => {
    expect(pickLandingOrg([PERSONAL], { personalOrgId: PERSONAL.id })).toBeNull();
  });

  it('lands in the company organization used last', () => {
    expect(pickLandingOrg([PERSONAL, ACME, GLOBEX], { lastUsedOrgId: GLOBEX.id })).toBe(GLOBEX);
  });

  it('lands in the first company organization when none was used yet', () => {
    expect(pickLandingOrg([PERSONAL, ACME, GLOBEX], {})).toBe(ACME);
  });

  it('ignores a last-used organization the person left', () => {
    expect(pickLandingOrg([ACME, PERSONAL], { lastUsedOrgId: 'org-gone' })).toBe(ACME);
  });

  it('treats the named personal organization as personal even without the flag', () => {
    const unflagged = { id: 'org-p2', name: 'personal_user-2' };
    expect(pickLandingOrg([unflagged, ACME], { personalOrgId: 'org-p2' })).toBe(ACME);
  });
});

describe('landingSwitchTarget', () => {
  const orgs = [ACME, PERSONAL, GLOBEX];

  it('moves someone in their personal organization', () => {
    expect(landingSwitchTarget(orgs, { activeOrgId: PERSONAL.id, lastUsedOrgId: GLOBEX.id })).toBe(GLOBEX);
  });

  it('leaves someone already in a company organization', () => {
    expect(landingSwitchTarget(orgs, { activeOrgId: ACME.id, lastUsedOrgId: GLOBEX.id })).toBeNull();
  });

  it('never overrides an organization the person just chose', () => {
    expect(landingSwitchTarget(orgs, { activeOrgId: PERSONAL.id, explicitChoice: true })).toBeNull();
  });

  it('stays for someone with only a personal organization', () => {
    expect(landingSwitchTarget([PERSONAL], { activeOrgId: PERSONAL.id })).toBeNull();
  });
});

describe('useOrgLanding', () => {
  const run = (props) => renderHook((p) => useOrgLanding(p), { initialProps: props });

  it('switches a personal session to the first company organization, once', () => {
    const switchOrg = vi.fn(async () => ({ ok: true }));
    const { rerender } = run({ sub: 'user-1', orgs: [ACME, PERSONAL], activeOrg: PERSONAL, switchOrg });
    rerender({ sub: 'user-1', orgs: [ACME, PERSONAL], activeOrg: PERSONAL, switchOrg });
    renderHook(() => useOrgLanding({ sub: 'user-1', orgs: [ACME, PERSONAL], activeOrg: PERSONAL, switchOrg }));

    expect(switchOrg).toHaveBeenCalledTimes(1);
    expect(switchOrg).toHaveBeenCalledWith(ACME.id);
  });

  it('remembers the company organization in use and returns to it', () => {
    const switchOrg = vi.fn();
    run({ sub: 'user-1', orgs: [ACME, GLOBEX, PERSONAL], activeOrg: GLOBEX, switchOrg });
    expect(readLastUsedOrgId('user-1')).toBe(GLOBEX.id);
    expect(switchOrg).not.toHaveBeenCalled();

    run({ sub: 'user-1', orgs: [ACME, GLOBEX, PERSONAL], activeOrg: PERSONAL, switchOrg });
    expect(switchOrg).toHaveBeenCalledWith(GLOBEX.id);
  });

  it('leaves the personal organization a person picked this session', () => {
    const switchOrg = vi.fn();
    markExplicitOrgChoice('user-1');
    run({ sub: 'user-1', orgs: [ACME, PERSONAL], activeOrg: PERSONAL, switchOrg });

    expect(switchOrg).not.toHaveBeenCalled();
  });
});
