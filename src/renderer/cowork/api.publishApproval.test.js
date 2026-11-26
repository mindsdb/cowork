import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: false,
  isElectron: true,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
  publishWithApproval: vi.fn(),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));
vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import { fetchPendingDatasources, publishArtifact, updateArtifact } from './api';
import { PUBLISH_SHELL_TOO_OLD_CODE } from './lib/sharingContract';

const res = (body, { status = 200 } = {}) => new Response(JSON.stringify(body), { status });
const APPROVED = [{ engine: 'postgres', name: 'scm', label: 'postgres/scm' }];
const sentBodies = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init.body));

describe('publishing with connection approval', () => {
  beforeEach(() => {
    hostMock.isElectron = true;
    hostMock.isWeb = false;
    hostMock.publishWithApproval.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => res({ url: 'https://view.example/r/1' })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends an explicit public access', async () => {
    await publishArtifact('/p/app', { mode: 'public' });
    await publishArtifact('/p/app', null);
    expect(sentBodies()).toEqual([
      { path: '/p/app', access: { mode: 'public' } },
      { path: '/p/app', access: { mode: 'public' } },
    ]);
  });

  it('goes through main when it approves connections, with no direct request', async () => {
    hostMock.publishWithApproval.mockResolvedValue({ ok: true, data: { url: 'u' } });
    await expect(publishArtifact('/p/app', { mode: 'public' }, { approvedDatasources: APPROVED })).resolves.toEqual({ url: 'u' });
    await updateArtifact('/p/app', { approvedDatasources: APPROVED });
    expect(hostMock.publishWithApproval.mock.calls.map(([o]) => o)).toEqual([
      { kind: 'publish', path: '/p/app', access: { mode: 'public' }, approvedDatasources: [{ engine: 'postgres', name: 'scm' }] },
      { kind: 'update', path: '/p/app', approvedDatasources: [{ engine: 'postgres', name: 'scm' }] },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads main's refusal as a direct request's", async () => {
    const body = { detail: { code: 'datasource_approval_required', message: 'm', pending: APPROVED } };
    hostMock.publishWithApproval.mockResolvedValue({ ok: false, status: 409, text: JSON.stringify(body), retryAfter: null });
    const err = await publishArtifact('/p/app', { mode: 'public' }, { approvedDatasources: APPROVED }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.code).toBe('datasource_approval_required');
    expect(err.body.detail.pending).toEqual(APPROVED);
  });

  it('asks for an app update on a shell without the bridge', async () => {
    hostMock.publishWithApproval.mockResolvedValue({ ok: false, reason: 'unsupported' });
    const err = await publishArtifact('/p/app', { mode: 'public' }, { approvedDatasources: APPROVED }).catch((e) => e);
    expect(err.code).toBe(PUBLISH_SHELL_TOO_OLD_CODE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the approval directly from the web build', async () => {
    hostMock.isElectron = false;
    hostMock.isWeb = true;
    await publishArtifact('/p/app', { mode: 'public' }, { approvedDatasources: APPROVED });
    expect(hostMock.publishWithApproval).not.toHaveBeenCalled();
    expect(sentBodies()).toEqual([
      { path: '/p/app', access: { mode: 'public' }, approved_datasources: [{ engine: 'postgres', name: 'scm' }] },
    ]);
  });

  it('reads the pending list', async () => {
    vi.mocked(fetch).mockResolvedValue(res({ pending: APPROVED }));
    await expect(fetchPendingDatasources('/p/app')).resolves.toEqual(APPROVED);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/publish/datasources?path=%2Fp%2Fapp');
  });
});
