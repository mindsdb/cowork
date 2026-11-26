import { postWithAppSecret, type AppSecretPostResult } from './app-secret-post';

/*
 * A publish that approves sending connections' credentials must carry the app
 * secret, which only main holds, so the renderer sends it through here.
 */

export type PublishApprovalResult = AppSecretPostResult;

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
  const body: Record<string, unknown> = { path: o.path };
  if (o.kind === 'publish' && o.access && typeof o.access === 'object') body.access = o.access;
  body.approved_datasources = o.approvedDatasources.map(({ engine, name }) => ({ engine, name }));
  return postWithAppSecret(ROUTES[o.kind], body);
}
