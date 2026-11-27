import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  mindshubListOrgs: vi.fn(),
  mindshubSwitchOrg: vi.fn(),
  mindshubArtifactSharePermission: vi.fn(),
  onMindsHubCredentialChanged: vi.fn(),
  onMindsHubAuthChanged: vi.fn(),
  isElectron: true,
}));
// The listeners the hook registers, so a test can fire them.
const listeners = vi.hoisted(() => ({ credential: new Set(), auth: new Set() }));
// A getter, so a test can flip `isElectron` after the mock is built.
vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  ...hostMock,
  get isElectron() { return hostMock.isElectron; },
}));

import { useDesktopOrgAudience } from './useDesktopOrgAudience';
import { notifyOrganizationChanged } from '../lib/organizationChanges';
import { isOrgAudienceOn } from '../lib/orgSharing';

const base64url = (value) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const tokenWith = (claims) => `${base64url({ alg: 'none' })}.${base64url({ sub: 'user-1', email: 'me@acme.com', ...claims })}.sig`;
const ACME_TOKEN = tokenWith({ activate_organization: { id: 'org-acme', name: 'acme' } });
const BETA_TOKEN = tokenWith({ activate_organization: { id: 'org-beta', name: 'beta' } });
const PERSONAL_TOKEN = tokenWith({ activate_organization: { id: 'org-me', name: 'personal_user-1' } });
const ALLOWED = { sessionCredential: true, known: true, canShareArtifactsOrg: true };

beforeEach(() => {
  hostMock.isElectron = true;
  hostMock.getAccessToken.mockReset().mockResolvedValue(ACME_TOKEN);
  hostMock.mindshubListOrgs.mockReset().mockResolvedValue({
    orgs: [{ id: 'org-acme', name: 'acme', displayName: 'Acme Inc', isPersonal: false }],
    activeOrgId: 'org-acme', reachable: true,
  });
  hostMock.mindshubArtifactSharePermission.mockReset().mockResolvedValue(ALLOWED);
  listeners.credential.clear();
  listeners.auth.clear();
  hostMock.onMindsHubCredentialChanged.mockReset().mockImplementation((cb) => {
    listeners.credential.add(cb);
    return () => listeners.credential.delete(cb);
  });
  hostMock.onMindsHubAuthChanged.mockReset().mockImplementation((cb) => {
    listeners.auth.add(cb);
    return () => listeners.auth.delete(cb);
  });
});

describe('useDesktopOrgAudience', () => {
  it('offers everyone at the organization once main answers', async () => {
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    expect(isOrgAudienceOn(result.current.capabilities)).toBe(false);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.capabilities).toMatchObject({
      enabled: false, orgAudience: true, canShareArtifactsOrg: true, permissionsKnown: true,
    });
    await waitFor(() => expect(result.current.orgName).toBe('Acme Inc'));
  });

  it('locks the card when auth could not be asked', async () => {
    hostMock.mindshubArtifactSharePermission.mockResolvedValue({ sessionCredential: true, known: false, canShareArtifactsOrg: false });
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.capabilities).toMatchObject({ orgAudience: true, permissionsKnown: false });
  });

  it('never offers it with a pasted key, on any render', async () => {
    hostMock.mindshubArtifactSharePermission.mockResolvedValue({ sessionCredential: false, known: false, canShareArtifactsOrg: false });
    const seen = [];
    const { result } = renderHook(() => { const r = useDesktopOrgAudience(true); seen.push(r); return r; });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(seen.every((r) => !isOrgAudienceOn(r.capabilities))).toBe(true);
  });

  it('asks nothing while inactive', async () => {
    const { result } = renderHook(() => useDesktopOrgAudience(false));
    await act(async () => {});
    expect(result.current.status).toBe('idle');
    expect(hostMock.getAccessToken).not.toHaveBeenCalled();
    expect(hostMock.mindshubArtifactSharePermission).not.toHaveBeenCalled();
    expect(hostMock.mindshubListOrgs).not.toHaveBeenCalled();
  });

  it('asks nothing on web', async () => {
    hostMock.isElectron = false;
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    await act(async () => {});
    expect(result.current.status).toBe('idle');
    expect(hostMock.mindshubArtifactSharePermission).not.toHaveBeenCalled();
  });

  it('offers nothing in a personal organization or signed out', async () => {
    hostMock.getAccessToken.mockResolvedValue(PERSONAL_TOKEN);
    const personal = renderHook(() => useDesktopOrgAudience(true));
    await act(async () => {});
    expect(isOrgAudienceOn(personal.result.current.capabilities)).toBe(false);
    hostMock.getAccessToken.mockResolvedValue(null);
    const signedOut = renderHook(() => useDesktopOrgAudience(true));
    await act(async () => {});
    expect(isOrgAudienceOn(signedOut.result.current.capabilities)).toBe(false);
    expect(hostMock.mindshubArtifactSharePermission).not.toHaveBeenCalled();
  });

  it('offers nothing on a shell without the call', async () => {
    hostMock.mindshubArtifactSharePermission.mockResolvedValue(null);
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalled());
    await act(async () => {});
    expect(isOrgAudienceOn(result.current.capabilities)).toBe(false);
  });

  it('asks once per mount, and again on the next mount', async () => {
    const first = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.rerender();
    await act(async () => {});
    expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalledTimes(1);
    // Main keeps the answer, after checking for a pasted key on each call.
    const second = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalledTimes(2);
  });

  it('never shows an earlier answer after leaving the organization and coming back', async () => {
    const seen = [];
    const { result } = renderHook(() => { const r = useDesktopOrgAudience(true); seen.push(r); return r; });
    await waitFor(() => expect(isOrgAudienceOn(result.current.capabilities)).toBe(true));
    hostMock.getAccessToken.mockResolvedValue(PERSONAL_TOKEN);
    await act(async () => { notifyOrganizationChanged('user-1'); });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    hostMock.mindshubArtifactSharePermission.mockResolvedValue({ sessionCredential: false, known: false, canShareArtifactsOrg: false });
    hostMock.getAccessToken.mockResolvedValue(ACME_TOKEN);
    const back = seen.length;
    await act(async () => { notifyOrganizationChanged('user-1'); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(seen.slice(back).every((r) => !isOrgAudienceOn(r.capabilities))).toBe(true);
  });

  it('asks again after the organization changes', async () => {
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    hostMock.getAccessToken.mockResolvedValue(BETA_TOKEN);
    hostMock.mindshubArtifactSharePermission.mockResolvedValue({ sessionCredential: true, known: true, canShareArtifactsOrg: false });
    await act(async () => { notifyOrganizationChanged('user-1'); });
    await waitFor(() => expect(result.current.capabilities.canShareArtifactsOrg).toBe(false));
    expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalledTimes(2);
  });

  it('takes the card away when a key is pasted while the viewer stays open', async () => {
    const seen = [];
    const { result } = renderHook(() => { const r = useDesktopOrgAudience(true); seen.push(r); return r; });
    await waitFor(() => expect(isOrgAudienceOn(result.current.capabilities)).toBe(true));
    hostMock.mindshubArtifactSharePermission.mockResolvedValue({ sessionCredential: false, known: false, canShareArtifactsOrg: false });
    const from = seen.length;
    await act(async () => { listeners.credential.forEach((cb) => cb()); });
    await waitFor(() => expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(seen.slice(from + 1).every((r) => !isOrgAudienceOn(r.capabilities))).toBe(true);
  });

  it('takes the card away on sign-out and asks again on sign-in', async () => {
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(isOrgAudienceOn(result.current.capabilities)).toBe(true));
    await act(async () => { listeners.auth.forEach((cb) => cb({ authenticated: false })); });
    expect(result.current.status).toBe('idle');
    expect(isOrgAudienceOn(result.current.capabilities)).toBe(false);
    await act(async () => { listeners.auth.forEach((cb) => cb({ authenticated: true })); });
    await waitFor(() => expect(isOrgAudienceOn(result.current.capabilities)).toBe(true));
    expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalledTimes(2);
  });

  it('asks nothing more on a token refresh', async () => {
    const { result } = renderHook(() => useDesktopOrgAudience(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { listeners.auth.forEach((cb) => cb({ authenticated: true })); });
    expect(result.current.status).toBe('ready');
    expect(hostMock.mindshubArtifactSharePermission).toHaveBeenCalledTimes(1);
  });

  it('stops listening once inactive', async () => {
    const { result, rerender } = renderHook(({ on }) => useDesktopOrgAudience(on), { initialProps: { on: true } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(listeners.credential.size).toBe(1);
    rerender({ on: false });
    expect(listeners.credential.size).toBe(0);
    expect(listeners.auth.size).toBe(0);
  });
});
