// The hook's default `offered` comes from the build and the host: Desktop and
// hosted web get the gallery; the mobile app and self-hosted web do not.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const load = async ({ isWeb, isMobileShell, platformUi }) => {
  vi.resetModules();
  vi.doMock('../../../platform/host', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, host: { ...actual.host, isWeb, isElectron: !isWeb, isMobileShell } };
  });
  vi.doMock('../../../lib/deployment', async (importOriginal) => ({ ...(await importOriginal()), PLATFORM_UI: platformUi }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  const { useHomeGallery } = await import('./useHomeGallery');
  return renderHook(() => useHomeGallery({ onHome: false, tasks: [], tasksStatus: 'loading' })).result.current.offered;
};

afterEach(() => {
  vi.doUnmock('../../../platform/host');
  vi.doUnmock('../../../lib/deployment');
  vi.unstubAllGlobals();
});

describe('where the gallery is offered by default', () => {
  it('Desktop', async () => expect(await load({ isWeb: false, isMobileShell: false, platformUi: true })).toBe(true));
  it('hosted web', async () => expect(await load({ isWeb: true, isMobileShell: false, platformUi: true })).toBe(true));
  it('not self-hosted web', async () => expect(await load({ isWeb: true, isMobileShell: false, platformUi: false })).toBe(false));
  it('not the mobile app', async () => expect(await load({ isWeb: true, isMobileShell: true, platformUi: true })).toBe(false));
});
