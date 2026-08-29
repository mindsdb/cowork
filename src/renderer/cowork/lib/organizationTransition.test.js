import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({ clearCachedSettings: vi.fn() }));
vi.mock('./settingsCache', () => cacheMock);

const draftMock = vi.hoisted(() => ({ clearDraftsForOrganizationSwitch: vi.fn() }));
vi.mock('./draftStore', () => draftMock);

import {
  __resetOrganizationTransitionForTests,
  assertOrganizationTransitionClear,
  beginOrganizationTransition,
  prepareForOrganizationReload,
  releaseOrganizationTransition,
  reloadForOrganizationTransition,
} from './organizationTransition';

const STORAGE_KEY = 'anton.organizationTransition';
let reloadSpy;
let lockHeld;
const locks = {
  request: vi.fn(async (_name, _options, callback) => {
    if (lockHeld) return callback(null);
    lockHeld = true;
    try {
      return await callback({ name: 'organization-transition' });
    } finally {
      lockHeld = false;
    }
  }),
};

beforeEach(() => {
  __resetOrganizationTransitionForTests();
  lockHeld = false;
  locks.request.mockClear();
  vi.stubGlobal('navigator', { locks });
  cacheMock.clearCachedSettings.mockReset();
  draftMock.clearDraftsForOrganizationSwitch.mockReset();
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
});

afterEach(() => {
  __resetOrganizationTransitionForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('organizationTransition', () => {
  it('persists a pending marker, blocks token work, and releases on refusal', async () => {
    const id = await beginOrganizationTransition('user-1');

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({
      id,
      phase: 'pending',
      subject: 'user-1',
    });
    expect(() => assertOrganizationTransitionClear())
      .toThrow('Organization change is in progress');

    releaseOrganizationTransition(id);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(() => assertOrganizationTransitionClear()).not.toThrow();
  });

  it('does not let a second tab replace an in-flight transition marker', async () => {
    const id = await beginOrganizationTransition('user-1');

    await expect(beginOrganizationTransition('user-1'))
      .rejects.toThrow('Another organization transition is in progress');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({
      id,
      phase: 'pending',
    });
  });

  it('publishes the reload outcome, clears tenant state, and reloads once', async () => {
    const id = await beginOrganizationTransition('user-1');

    reloadForOrganizationTransition(id);
    prepareForOrganizationReload({ transitionId: id });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({ id, phase: 'reload' });
    expect(cacheMock.clearCachedSettings).toHaveBeenCalledTimes(1);
    expect(draftMock.clearDraftsForOrganizationSwitch).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(cacheMock.clearCachedSettings.mock.invocationCallOrder[0])
      .toBeLessThan(draftMock.clearDraftsForOrganizationSwitch.mock.invocationCallOrder[0]);
    expect(draftMock.clearDraftsForOrganizationSwitch.mock.invocationCallOrder[0])
      .toBeLessThan(reloadSpy.mock.invocationCallOrder[0]);
  });

  it('can heal the token adapter without deleting current-tenant state', () => {
    prepareForOrganizationReload({ clearTenantState: false });

    expect(cacheMock.clearCachedSettings).not.toHaveBeenCalled();
    expect(draftMock.clearDraftsForOrganizationSwitch).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('applies a reload marker published by another tab', () => {
    const pending = JSON.stringify({
      version: 1,
      id: 'remote-transition',
      phase: 'pending',
      subject: 'user-1',
      startedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEY, pending);
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: pending,
    }));
    expect(() => assertOrganizationTransitionClear())
      .toThrow('Organization change is in progress');

    const reload = JSON.stringify({
      version: 1,
      id: 'remote-transition',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEY, reload);
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: reload,
    }));

    expect(cacheMock.clearCachedSettings).toHaveBeenCalledTimes(1);
    expect(draftMock.clearDraftsForOrganizationSwitch).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('rechecks a reload marker when a bfcached document resumes', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      id: 'sleeping-tab-transition',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now(),
    }));

    window.dispatchEvent(new Event('pageshow'));

    expect(cacheMock.clearCachedSettings).toHaveBeenCalledTimes(1);
    expect(draftMock.clearDraftsForOrganizationSwitch).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads an older document when it resumes during a later pending switch', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      id: 'pending-transition-c',
      phase: 'pending',
      subject: 'user-1',
      startedAt: Date.now(),
      previousReload: {
        id: 'committed-transition-b',
        subject: 'user-1',
        startedAt: Date.now() - 60_000,
      },
    }));

    window.dispatchEvent(new Event('pageshow'));

    expect(cacheMock.clearCachedSettings).toHaveBeenCalledTimes(1);
    expect(draftMock.clearDraftsForOrganizationSwitch).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('turns an abandoned pending marker into a defensive reload', async () => {
    vi.useFakeTimers();
    await beginOrganizationTransition('user-1');

    await vi.advanceTimersByTimeAsync(25_000);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({ phase: 'reload' });
    expect(cacheMock.clearCachedSettings).toHaveBeenCalledTimes(1);
    expect(draftMock.clearDraftsForOrganizationSwitch).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes a defensive reload if the initiating document leaves mid-switch', async () => {
    const id = await beginOrganizationTransition('user-1');

    window.dispatchEvent(new Event('pagehide'));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({ id, phase: 'reload' });
    expect(cacheMock.clearCachedSettings).toHaveBeenCalledTimes(1);
    expect(draftMock.clearDraftsForOrganizationSwitch).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
