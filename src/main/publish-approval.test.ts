import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./server-process', () => ({ getServerPort: () => 4000 }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));

import { publishWithApproval } from './publish-approval';
import { APP_SECRET_HEADER, clearAppSecret, newAppSecret, setServerTrust } from './app-secret';

type Sent = { url: string; headers: Record<string, string>; body: unknown; signal: unknown };

function fakeServer(status = 200, body: unknown = { url: 'https://view.example/r/1' }): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string), signal: init.signal });
    return new Response(JSON.stringify(body), { status });
  }));
  return sent;
}

const APPROVED = [{ engine: 'postgres', name: 'scm' }];

beforeEach(() => { clearAppSecret(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('publish with connection approval from main', () => {
  it('sends the app secret, the approval and the access, with no timeout', async () => {
    const secret = newAppSecret();
    setServerTrust('protected');
    const sent = fakeServer();

    await expect(publishWithApproval({ kind: 'publish', path: '/p/app', access: { mode: 'public' }, approvedDatasources: APPROVED }))
      .resolves.toEqual({ ok: true, data: { url: 'https://view.example/r/1' } });
    await publishWithApproval({ kind: 'update', path: '/p/app', approvedDatasources: APPROVED });

    expect(sent.map((s) => s.url)).toEqual([
      'http://127.0.0.1:4000/api/v1/publish',
      'http://127.0.0.1:4000/api/v1/publish/update',
    ]);
    expect(sent[0].body).toEqual({ path: '/p/app', access: { mode: 'public' }, approved_datasources: APPROVED });
    expect(sent[1].body).toEqual({ path: '/p/app', approved_datasources: APPROVED });
    for (const s of sent) {
      expect(s.headers[APP_SECRET_HEADER]).toBe(secret);
      expect(s.headers.Authorization).toBe('Bearer bearer');
      expect(s.signal).toBeUndefined();
    }
  });

  it("passes the server's refusal through as it was sent", async () => {
    newAppSecret();
    setServerTrust('protected');
    const body = { detail: { code: 'datasource_approval_required', message: 'm', pending: [] } };
    fakeServer(409, body);
    await expect(publishWithApproval({ kind: 'publish', path: '/p/app', approvedDatasources: APPROVED }))
      .resolves.toEqual({ ok: false, status: 409, text: JSON.stringify(body), retryAfter: null });
  });

  it.each([
    [{ kind: 'delete', path: '/p/app', approvedDatasources: APPROVED }],
    [{ kind: 'publish', path: '', approvedDatasources: APPROVED }],
    [{ kind: 'publish', path: '/p/app', approvedDatasources: [] }],
    [{ kind: 'publish', path: '/p/app', approvedDatasources: [{ engine: 1 }] }],
  ])('refuses a malformed request without calling the server: %j', async (opts) => {
    setServerTrust('protected');
    const sent = fakeServer();
    const out = await publishWithApproval(opts);
    expect(out.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends nothing to an untrusted server', async () => {
    setServerTrust('untrusted');
    const sent = fakeServer();
    const out = await publishWithApproval({ kind: 'publish', path: '/p/app', approvedDatasources: APPROVED });
    expect(out).toEqual({ ok: false, reason: 'The backend could not be verified. Restart Cowork and try again.' });
    expect(sent).toEqual([]);
  });
});
