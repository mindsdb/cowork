import { describe, it, expect, vi } from 'vitest';
import { readArtifactSharePermission, type ArtifactSharePermissionDeps } from './artifact-share-permission';

const AUTH = 'https://auth.example/v1';

function deps(over: Partial<ArtifactSharePermissionDeps> = {}): ArtifactSharePermissionDeps {
  return {
    userSuppliedCredential: async () => false,
    accessToken: async () => 'jwt-1',
    fetch: vi.fn(async () => new Response(JSON.stringify({ org_role: 'member', permissions: ['artifacts.share_org'] }), { status: 200 })),
    authServiceUrl: AUTH,
    ...over,
  };
}

const answering = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('readArtifactSharePermission', () => {
  it('asks auth for the caller entitlements with the session token', async () => {
    const d = deps();
    await readArtifactSharePermission(d);
    expect(d.fetch).toHaveBeenCalledWith(`${AUTH}/entitlements/me/`, expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-1', 'X-MindsDB-Product': 'hub' }),
    }));
  });

  it('allows a member whose permissions include artifacts.share_org', async () => {
    await expect(readArtifactSharePermission(deps())).resolves.toEqual({
      sessionCredential: true, known: true, canShareArtifactsOrg: true,
    });
  });

  it('refuses a member without artifacts.share_org', async () => {
    const d = deps({ fetch: answering(200, { org_role: 'member', permissions: ['skills.share_org'] }) });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: true, known: true, canShareArtifactsOrg: false,
    });
  });

  it('reads an admin from the permissions alone, as auth checks it', async () => {
    const d = deps({ fetch: answering(200, { org_role: 'admin', permissions: ['artifacts.share_org', 'skills.share_org'] }) });
    await expect(readArtifactSharePermission(d)).resolves.toMatchObject({ known: true, canShareArtifactsOrg: true });
  });

  it('treats a membership auth could not resolve as unknown', async () => {
    const d = deps({ fetch: answering(200, { org_role: null, permissions: [] }) });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: true, known: false, canShareArtifactsOrg: false,
    });
  });

  it.each([401, 403, 500, 503])('treats HTTP %s as unknown', async (status) => {
    const d = deps({ fetch: answering(status, { detail: 'no' }) });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: true, known: false, canShareArtifactsOrg: false,
    });
  });

  it('treats a network failure as unknown', async () => {
    const d = deps({ fetch: vi.fn(async () => { throw new TypeError('fetch failed'); }) });
    await expect(readArtifactSharePermission(d)).resolves.toMatchObject({ known: false, canShareArtifactsOrg: false });
  });

  it('treats a body that is not JSON as unknown', async () => {
    const d = deps({ fetch: vi.fn(async () => new Response('<html>', { status: 200 })) });
    await expect(readArtifactSharePermission(d)).resolves.toMatchObject({ known: false });
  });

  it('asks nothing without a token', async () => {
    const d = deps({ accessToken: async () => null });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: true, known: false, canShareArtifactsOrg: false,
    });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('reports a pasted key without asking auth', async () => {
    const d = deps({ userSuppliedCredential: async () => true });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: false, known: false, canShareArtifactsOrg: false,
    });
    expect(d.fetch).not.toHaveBeenCalled();
  });
});
