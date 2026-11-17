import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AUTH_IMAGE_HOST } from '../../lib/orgBranding';

const fetchOrgBranding = vi.fn();
const fetchHubOrgIcons = vi.fn(async () => null);
vi.mock('../api', () => ({
  fetchOrgBranding: (...args) => fetchOrgBranding(...args),
  fetchHubOrgIcons: (...args) => fetchHubOrgIcons(...args),
}));

let authListener = null;
const brandImages = vi.fn();
const token = { value: null };
vi.mock('../../platform/host', () => ({
  getAccessToken: async () => token.value,
  onMindsHubAuthChanged: (cb) => { authListener = cb; return () => { authListener = null; }; },
  mindshubBrandImages: (...args) => brandImages(...args),
  mindshubOrgIconUris: (...args) => iconUris(...args),
}));
const iconUris = vi.fn(async () => ({}));

import { useOrgBranding } from './useOrgBranding';
import { parseOrgBranding } from '../../lib/orgBranding';
import { getOrgIcons, setOrgIcons } from '../lib/orgIcons';
import { cacheOrgBranding, loadCachedOrgBranding, __resetOrgBrandingCacheForTests } from '../lib/orgBrandingCache';
import { notifyOrganizationChanged } from '../lib/organizationChanges';

function jwt(sub, orgId, extra = {}) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none' })}.${enc({ sub, activate_organization: { id: orgId, name: orgId }, ...extra })}.sig`;
}

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
  fetchHubOrgIcons.mockReset();
  fetchHubOrgIcons.mockResolvedValue(null);
  iconUris.mockReset();
  iconUris.mockResolvedValue({});
  setOrgIcons({});
  authListener = null;
  token.value = jwt('user-1', 'org-acme');
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

  it('reads again when Settings opens, an org switch lands, or the account or org changes, and never on a timer', async () => {
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

      // A silent token refresh: same account and org, no read.
      token.value = jwt('user-1', 'org-acme', { iat: 2 });
      await act(async () => { await authListener?.({ authenticated: true }); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(3);
      // Signed out, then in as someone else: a read each.
      token.value = null;
      await act(async () => { await authListener?.({ authenticated: false }); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(4);
      token.value = jwt('user-2', 'org-globex');
      await act(async () => { await authListener?.({ authenticated: true }); });
      expect(fetchOrgBranding).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the org being left at once on an org switch, and never shows it in the new org", async () => {
    cacheOrgBranding(parseOrgBranding(answer('Org A')));
    fetchOrgBranding.mockResolvedValueOnce(answer('Org A'));
    const { result } = renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
    await waitFor(() => expect(result.current.branding?.appearance.greeting).toBe('Org A'));
    fetchOrgBranding.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { notifyOrganizationChanged('user-1'); });
    expect(result.current.branding).toBeNull();
    expect(loadCachedOrgBranding()).toBeNull();
  });

  it("puts the stock app icon back at once on desktop when the org changes", async () => {
    fetchOrgBranding.mockResolvedValueOnce({ ...answer('Org A'), iconUrl: null });
    brandImages.mockResolvedValue({ iconUrl: null, logoUrl: null, logoDarkUrl: null });
    renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
    await waitFor(() => expect(brandImages).toHaveBeenCalledTimes(1));
    fetchOrgBranding.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { notifyOrganizationChanged('user-1'); });
    expect(brandImages).toHaveBeenLastCalledWith(null);
  });

  it("keeps the last good branding, uncached, when the server couldn't reach auth", async () => {
    fetchOrgBranding.mockResolvedValueOnce(answer('Branded'));
    const { result } = renderHook(({ open }) => useOrgBranding({ enabled: true, settingsOpen: open }), { initialProps: { open: false } });
    await waitFor(() => expect(result.current.branding?.appearance.greeting).toBe('Branded'));
    fetchOrgBranding.mockResolvedValueOnce({ enabled: true, reachable: false, sidebarTitle: 'MindsHub', canEdit: false, appearance: {} });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.branding.appearance.greeting).toBe('Branded');
    expect(loadCachedOrgBranding().appearance.greeting).toBe('Branded');
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

  describe('org switcher icons', () => {
    const remoteIcon = (id) => `https://${AUTH_IMAGE_HOST}/v1/organizations/${id}/branding/icon?v=1`;

    it('reads them with the branding, at the same moments, and keeps only trusted URLs', async () => {
      fetchOrgBranding.mockResolvedValue(answer('Hi'));
      fetchHubOrgIcons.mockResolvedValue({ reachable: true, orgs: [
        { id: 'org-acme', iconUrl: remoteIcon('org-acme') },
        { id: 'org-globex', iconUrl: '/v1/organizations/org-globex/branding/icon' },
      ] });
      const { rerender } = renderHook(({ open }) => useOrgBranding({ enabled: true, settingsOpen: open }), { initialProps: { open: false } });
      await waitFor(() => expect(getOrgIcons()).toEqual({ 'org-acme': remoteIcon('org-acme') }));
      expect(fetchHubOrgIcons).toHaveBeenCalledTimes(1);
      rerender({ open: true });
      await waitFor(() => expect(fetchHubOrgIcons).toHaveBeenCalledTimes(2));
    });

    it('keeps what it shows when the read fails', async () => {
      setOrgIcons({ 'org-acme': remoteIcon('org-acme') });
      fetchOrgBranding.mockResolvedValue(answer('Hi'));
      fetchHubOrgIcons.mockResolvedValue(null);
      renderHook(() => useOrgBranding({ enabled: true, settingsOpen: false }));
      await waitFor(() => expect(fetchHubOrgIcons).toHaveBeenCalled());
      expect(getOrgIcons()).toEqual({ 'org-acme': remoteIcon('org-acme') });
    });

    it('turns them into data URIs through main on desktop', async () => {
      fetchOrgBranding.mockResolvedValue({ enabled: false });
      fetchHubOrgIcons.mockResolvedValue({ reachable: true, orgs: [{ id: 'org-acme', iconUrl: remoteIcon('org-acme') }] });
      iconUris.mockResolvedValue({ 'org-acme': 'data:image/png;base64,AA==' });
      renderHook(() => useOrgBranding({ enabled: false, desktop: true, settingsOpen: false }));
      await waitFor(() => expect(getOrgIcons()).toEqual({ 'org-acme': 'data:image/png;base64,AA==' }));
      expect(iconUris).toHaveBeenCalledWith({ 'org-acme': remoteIcon('org-acme') });
    });
  });
});
