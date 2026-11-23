import { getServerPort } from './server-process';
import { authHeader } from './server-auth';
import { appSecretHeader, serverMayReceiveTokens, serverTrust } from './app-secret';

/*
 * A publish that approves sending connections' credentials must carry the app
 * secret, which only main holds, so the renderer sends it through here.
 */

export type PublishApprovalResult =
  | { ok: true; data: unknown }
  // The server's own refusal, passed through so the renderer reads it as it
  // reads a direct request's.
  | { ok: false; status: number; text: string; retryAfter: string | null }
  | { ok: false; reason: string };

type Datasource = { engine: string; name: string };

const ROUTES = { publish: '/api/v1/publish', update: '/api/v1/publish/update' } as const;

function isDatasourceList(value: unknown): value is Datasource[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (d) => !!d && typeof d === 'object'
      && typeof (d as Datasource).engine === 'string'
      && typeof (d as Datasource).name === 'string',
  );
}

export async function publishWithApproval(opts: unknown): Promise<PublishApprovalResult> {
  const o = (opts ?? {}) as { kind?: unknown; path?: unknown; access?: unknown; approvedDatasources?: unknown };
  if (o.kind !== 'publish' && o.kind !== 'update') return { ok: false, reason: 'Unknown publish request.' };
  if (typeof o.path !== 'string' || !o.path) return { ok: false, reason: 'An artifact path is required.' };
  if (!isDatasourceList(o.approvedDatasources)) return { ok: false, reason: 'No connections to approve.' };
  if (!serverMayReceiveTokens()) {
    return {
      ok: false,
      reason: serverTrust() === 'untrusted'
        ? 'The backend could not be verified. Restart Cowork and try again.'
        : 'The backend is not running.',
    };
  }
  const approved = o.approvedDatasources.map(({ engine, name }) => ({ engine, name }));
  const body: Record<string, unknown> = { path: o.path };
  if (o.kind === 'publish' && o.access && typeof o.access === 'object') body.access = o.access;
  body.approved_datasources = approved;
  let res: Response;
  try {
    // No timeout: a full-stack build on the server can take minutes, and the
    // renderer's direct /publish request waits for it too.
    res = await fetch(`http://127.0.0.1:${getServerPort()}${ROUTES[o.kind]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(), ...appSecretHeader() },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'The backend is not running.' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, text, retryAfter: res.headers.get('Retry-After') };
  }
  return { ok: true, data: await res.json().catch(() => null) };
}
