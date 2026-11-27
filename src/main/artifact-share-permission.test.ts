import { describe, it, expect, vi } from 'vitest';
import { KEEP_ANSWER_MS, createArtifactSharePermissionReader, type ArtifactSharePermissionDeps } from './artifact-share-permission';

const AUTH = 'https://auth.example/v1';

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (sub: string, orgId: string) =>
  `${base64url({ alg: 'none' })}.${base64url({ sub, active_organization: { id: orgId, name: orgId } })}.sig`;
const ACME = tokenFor('user-1', 'org-acme');
const BETA = tokenFor('user-1', 'org-beta');

function deps(over: Partial<ArtifactSharePermissionDeps> = {}): ArtifactSharePermissionDeps {
  return {
    userSuppliedCredential: async () => false,
    accessToken: async () => ACME,
    fetch: vi.fn(async () => new Response(JSON.stringify({ org_role: 'member', permissions: ['artifacts.share_org'] }), { status: 200 })),
    authServiceUrl: AUTH,
    ...over,
  };
}

const answering = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

const readArtifactSharePermission = (d: ArtifactSharePermissionDeps) => createArtifactSharePermissionReader(d).read();

describe('readArtifactSharePermission', () => {
  it('asks auth for the caller entitlements with the session token', async () => {
    const d = deps();
    await readArtifactSharePermission(d);
    expect(d.fetch).toHaveBeenCalledWith(`${AUTH}/entitlements/me/`, expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: `Bearer ${ACME}`, 'X-MindsDB-Product': 'hub' }),
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

  it('reports no session credential when the pasted-key check fails', async () => {
    const d = deps({ userSuppliedCredential: async () => { throw new Error('store unreadable'); } });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: false, known: false, canShareArtifactsOrg: false,
    });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('treats a token that cannot be read as unknown', async () => {
    const d = deps({ accessToken: async () => { throw new Error('refresh failed'); } });
    await expect(readArtifactSharePermission(d)).resolves.toEqual({
      sessionCredential: true, known: false, canShareArtifactsOrg: false,
    });
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe('createArtifactSharePermissionReader', () => {
  it('reuses a known answer for the same person and organization', async () => {
    const d = deps();
    const reader = createArtifactSharePermissionReader(d);
    await reader.read();
    await expect(reader.read()).resolves.toEqual({ sessionCredential: true, known: true, canShareArtifactsOrg: true });
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again after an unknown answer', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: ['artifacts.share_org'] }), { status: 200 }));
    const reader = createArtifactSharePermissionReader(deps({ fetch }));
    await expect(reader.read()).resolves.toMatchObject({ known: false });
    await expect(reader.read()).resolves.toMatchObject({ known: true, canShareArtifactsOrg: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks again for another organization in the token', async () => {
    let token = ACME;
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: ['artifacts.share_org'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: [] }), { status: 200 }));
    const reader = createArtifactSharePermissionReader(deps({ fetch, accessToken: async () => token }));
    await expect(reader.read()).resolves.toMatchObject({ canShareArtifactsOrg: true });
    token = BETA;
    await expect(reader.read()).resolves.toMatchObject({ known: true, canShareArtifactsOrg: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('checks for a pasted key before the kept answer', async () => {
    let pasted = false;
    const d = deps({ userSuppliedCredential: async () => pasted });
    const reader = createArtifactSharePermissionReader(d);
    await expect(reader.read()).resolves.toMatchObject({ known: true, canShareArtifactsOrg: true });
    pasted = true;
    await expect(reader.read()).resolves.toEqual({ sessionCredential: false, known: false, canShareArtifactsOrg: false });
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again once a granted answer is older than its lifetime, so a withdrawn permission shows up', async () => {
    let clock = 1_000;
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: ['artifacts.share_org'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: [] }), { status: 200 }));
    const reader = createArtifactSharePermissionReader(deps({ fetch, now: () => clock }));
    await expect(reader.read()).resolves.toMatchObject({ canShareArtifactsOrg: true });
    clock += KEEP_ANSWER_MS - 1;
    await expect(reader.read()).resolves.toMatchObject({ canShareArtifactsOrg: true });
    clock += 1;
    await expect(reader.read()).resolves.toMatchObject({ canShareArtifactsOrg: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks again after a refusal, so a permission just granted unlocks the card', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ org_role: 'member', permissions: ['artifacts.share_org'] }), { status: 200 }));
    const reader = createArtifactSharePermissionReader(deps({ fetch }));
    await expect(reader.read()).resolves.toMatchObject({ known: true, canShareArtifactsOrg: false });
    await expect(reader.read()).resolves.toMatchObject({ known: true, canShareArtifactsOrg: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
