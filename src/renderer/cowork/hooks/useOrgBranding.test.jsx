import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AUTH_IMAGE_HOST } from '../../lib/orgBranding';

const fetchOrgBranding = vi.fn();
vi.mock('../api', () => ({ fetchOrgBranding: (...args) => fetchOrgBranding(...args) }));

let authListener = null;
const brandImages = vi.fn();
vi.mock('../../platform/host', () => ({
  onMindsHubAuthChanged: (cb) => { authListener = cb; return () => { authListener = null; }; },
  mindshubBrandImages: (...args) => brandImages(...args),
}));

import { useOrgBranding } from './useOrgBranding';
import { parseOrgBranding } from '../../lib/orgBranding';
import { cacheOrgBranding, __resetOrgBrandingCacheForTests } from '../lib/orgBrandingCache';
import { notifyOrganizationChanged } from '../lib/organizationChanges';

const LOGO = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/logo?v=1`;
const answer = (greeting) => ({
  enabled: true,
  iconUrl: null,
  logoUrl: LOGO,
  logoDarkUrl: null,
  canEdit: true,
  appearance: { greeting, membersCanChoose: true },
});

beforeEach(() => {
  localStorage.clear();
  __resetOrgBrandingCacheForTests();
  fetchOrgBranding.mockReset();
  brandImages.mockReset();
  authListener = null;
});

describe('useOrgBranding', () => {
  it('reads nothing and answers null outside hosted org mode', async () => {
    const { result } = renderHook(() => useOrgBranding({ enabled: false, settingsOpen: false }));
    await act(async () => {});
    expect(fetchOrgBranding).not.toHaveBeenCalled();
    expect(result.current.branding).toBeNull();
  });

  it('paints the cached answer first, then the startup read', async () => {
    cacheOrgBranding({ ...answer('Cached'), appearance: { ...answer('Cached').appearance } });
    let resolve;
    fetchOrgBranding.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    expect(result.current.branding.appearance.greeting).toBe('Cached');
    expect(fetchOrgBranding).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(answer('Fresh')); });
    expect(result.current.branding.appearance.greeting).toBe('Fresh');
  });

  it('keeps what it shows when a read fails', async () => {
    cacheOrgBranding({ ...answer('Cached') });
    fetchOrgBranding.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    await act(async () => {});
    expect(result.current.branding.appearance.greeting).toBe('Cached');
  });

  it('reads again when Settings opens, an org switch lands, or a sign-in lands, and never on a timer', async () => {
    vi.useFakeTimers();
    try {
      fetchOrgBranding.mockResolvedValue(answer('Hi'));
      const { rerender } = renderHook(({ open }) => useOrgBranding({ enabled: true, settingsOpen: open }), {
        initialProps: { open: false },
      });
      await act(async () => {});
      expect(fetchOrgBranding).toHaveBeenCalledTimes(1);

      await act(async () => { vi.advanceTimersByTime(60 * 60 * 1000); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(1);

      rerender({ open: true });
      await act(async () => {});
      expect(fetchOrgBranding).toHaveBeenCalledTimes(2);
      rerender({ open: true });
      rerender({ open: false });
      await act(async () => {});
      expect(fetchOrgBranding).toHaveBeenCalledTimes(2);

      await act(async () => { notifyOrganizationChanged('user-1'); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(3);

      await act(async () => { authListener?.({ authenticated: true }); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(4);
      await act(async () => { authListener?.({ authenticated: false }); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies and caches an admin's saved answer without another read", async () => {
    fetchOrgBranding.mockResolvedValue(answer('Before'));
    const { result } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    await waitFor(() => expect(result.current.branding?.appearance.greeting).toBe('Before'));
    act(() => { result.current.apply(answer('After')); });
    expect(result.current.branding.appearance.greeting).toBe('After');
    expect(fetchOrgBranding).toHaveBeenCalledTimes(1);

    const { result: next } = renderHook(() => useOrgBranding({ enabled: false, settingsOpen: false }));
    expect(next.current.branding).toBeNull();
  });

  it('drops a read that lands after a newer answer', async () => {
    let resolveFirst;
    fetchOrgBranding.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { result } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    act(() => { result.current.apply(answer('Saved')); });
    await act(async () => { resolveFirst(answer('Stale')); });
    expect(result.current.branding.appearance.greeting).toBe('Saved');
  });

  it("replaces a cached sidebar title with the fresh one after a company rename", async () => {
    cacheOrgBranding({ ...answer('Hi'), sidebarTitle: 'Acme', orgName: 'Acme' });
    fetchOrgBranding.mockResolvedValue({ ...answer('Hi'), sidebarTitle: 'Acme Corp', orgName: 'Acme Corp' });
    const { result } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    expect(result.current.branding.sidebarTitle).toBe('Acme');
    await waitFor(() => expect(result.current.branding.sidebarTitle).toBe('Acme Corp'));
    // The cache now holds the fresh answer for the next first paint.
    const { result: next } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    expect(next.current.branding.sidebarTitle).toBe('Acme Corp');
  });

  describe('on desktop', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const remote = (kind) => `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/${kind}?v=1`;
    const answerWithImages = { ...answer('Hi'), iconUrl: remote('icon'), logoUrl: remote('logo') };

    it('reads org-branding from the local server and swaps the image URLs for main\'s data URIs', async () => {
      fetchOrgBranding.mockResolvedValue(answerWithImages);
      brandImages.mockResolvedValue({ iconUrl: PNG, logoUrl: PNG, logoDarkUrl: null });
      const { result } = renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
      await waitFor(() => expect(result.current.branding?.logoUrl).toBe(PNG));
      expect(brandImages).toHaveBeenCalledWith({ iconUrl: remote('icon'), logoUrl: remote('logo'), logoDarkUrl: null });
      expect(result.current.branding).toMatchObject({ enabled: true, iconUrl: PNG, canEdit: true });
      expect(result.current.branding.appearance.greeting).toBe('Hi');
    });

    it('caches the URLs, not the data URIs, and paints the cached look without images first', async () => {
      cacheOrgBranding(parseOrgBranding(answerWithImages));
      let resolve;
      fetchOrgBranding.mockReturnValue(new Promise((r) => { resolve = r; }));
      const { result } = renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
      expect(result.current.branding.appearance.greeting).toBe('Hi');
      expect(result.current.branding.logoUrl).toBeNull();
      brandImages.mockResolvedValue({ iconUrl: PNG, logoUrl: PNG, logoDarkUrl: null });
      await act(async () => { resolve(answerWithImages); });
      await waitFor(() => expect(result.current.branding.logoUrl).toBe(PNG));
      const cached = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('anton.orgBrandingCache'))));
      expect(cached.branding.logoUrl).toBe(remote('logo'));
    });

    it('resets the app icon when there is no org branding (signed out, personal org)', async () => {
      fetchOrgBranding.mockResolvedValue({ enabled: false });
      const { result } = renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
      await waitFor(() => expect(brandImages).toHaveBeenCalledWith(null));
      expect(result.current.branding).toMatchObject({ enabled: false });
    });

    it('keeps only PNG, JPEG or WebP data URIs from main', async () => {
      fetchOrgBranding.mockResolvedValue(answerWithImages);
      brandImages.mockResolvedValue({ iconUrl: 'https://images.globex.com/i.png', logoUrl: 'data:image/svg+xml;base64,PHN2Zz4=' });
      const { result } = renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
      await waitFor(() => expect(brandImages).toHaveBeenCalled());
      await act(async () => {});
      expect(result.current.branding).toMatchObject({ enabled: true, iconUrl: null, logoUrl: null });
    });

    it("keeps the images it shows across an admin's save", async () => {
      fetchOrgBranding.mockResolvedValue(answerWithImages);
      brandImages.mockResolvedValue({ iconUrl: PNG, logoUrl: PNG, logoDarkUrl: null });
      const { result } = renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
      await waitFor(() => expect(result.current.branding?.logoUrl).toBe(PNG));
      act(() => { result.current.apply({ ...answerWithImages, appearance: { greeting: 'Saved', membersCanChoose: true } }); });
      expect(result.current.branding).toMatchObject({ logoUrl: PNG, iconUrl: PNG });
      expect(result.current.branding.appearance.greeting).toBe('Saved');
    });
  });
});
