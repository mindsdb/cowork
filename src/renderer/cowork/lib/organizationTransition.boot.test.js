import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({ clearCachedSettings: vi.fn() }));
vi.mock('./settingsCache', () => cacheMock);

const draftMock = vi.hoisted(() => ({ clearDraftsForOrganizationSwitch: vi.fn() }));
vi.mock('./draftStore', () => draftMock);

const STORAGE_KEY = 'anton.organizationTransition';
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
  localStorage.clear();
  lockHeld = false;
  locks.request.mockClear();
  vi.stubGlobal('navigator', { locks });
  cacheMock.clearCachedSettings.mockReset();
  draftMock.clearDraftsForOrganizationSwitch.mockReset();
  vi.resetModules();
});

describe('organizationTransition module startup', () => {
  it('adopts an earlier reload marker without erasing current-organization state', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      id: 'completed-transition',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now() - 60_000,
    }));

    const { assertOrganizationTransitionClear } = await import('./organizationTransition');

    expect(() => assertOrganizationTransitionClear()).not.toThrow();
    expect(cacheMock.clearCachedSettings).not.toHaveBeenCalled();
    expect(draftMock.clearDraftsForOrganizationSwitch).not.toHaveBeenCalled();
  });

  it('keeps a fresh pending-era document current when the switch is refused', async () => {
    const previous = {
      version: 1,
      id: 'previous-transition',
      phase: 'reload',
      subject: 'user-1',
      startedAt: Date.now() - 60_000,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(previous));
    const owner = await import('./organizationTransition');
    const pendingId = await owner.beginOrganizationTransition('user-1');

    vi.resetModules();
    const openedDuringPending = await import('./organizationTransition');
    owner.releaseOrganizationTransition(pendingId);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(previous);
    expect(() => openedDuringPending.assertOrganizationTransitionClear()).not.toThrow();
    expect(cacheMock.clearCachedSettings).not.toHaveBeenCalled();
    expect(draftMock.clearDraftsForOrganizationSwitch).not.toHaveBeenCalled();
  });
});
