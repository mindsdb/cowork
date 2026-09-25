// The cloud datasource relay client.
//
// Every call here is org-mode only: the server's routes answer 404 outside it
// by design, so an ungated call would put an error banner on the desktop
// connections page. The relay also answers with an object detail
// (`{code, message}`) rather than the string or list shape every other
// endpoint uses, and the form has to show that message and branch on that
// code — a stale-version conflict is only distinguishable by it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));
vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import {
  listDatasourceConnections,
  createDatasourceConnection,
  getDatasourceConnection,
  editDatasourceConnection,
  deleteDatasourceConnection,
  retryDatasourceValidation,
} from './api';
import { setOrgMode } from '../lib/orgMode';

const res = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const VERIFIED = {
  id: 7,
  connector_id: 'postgres',
  method: 'host-port',
  name: 'analytics',
  status: 'verified',
  credential_version: 3,
  revision: 6,
  host_masked: 'db.***.example.com',
  port: 5432,
  database: 'analytics',
  username: 'readonly',
  tls_mode: 'system',
};

function lastCall() {
  const [url, init] = global.fetch.mock.calls.at(-1);
  return { url, init, body: init?.body ? JSON.parse(init.body) : undefined };
}

beforeEach(() => {
  setOrgMode(true);
  global.fetch = vi.fn(async () => res(VERIFIED));
});

afterEach(() => {
  setOrgMode(false);
  vi.restoreAllMocks();
});

describe('the datasource relay calls', () => {
  it('lists from the relay, not the OAuth connection route', async () => {
    global.fetch = vi.fn(async () => res([VERIFIED]));
    const rows = await listDatasourceConnections();

    expect(rows).toEqual([VERIFIED]);
    const { url, init } = lastCall();
    expect(url).toBe('http://127.0.0.1:26866/api/v1/connectors/datasources/');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('creates with the structured body the relay validates', async () => {
    const payload = {
      connector_id: 'postgres',
      method: 'host-port',
      name: 'analytics',
      input_mode: 'structured',
      host: 'db.example.com',
      port: 5432,
      database: 'analytics',
      username: 'readonly',
      password: 'secret',
      tls: { mode: 'system', ca_pem: null },
    };
    await createDatasourceConnection(payload);

    const { url, init, body } = lastCall();
    expect(url).toBe('http://127.0.0.1:26866/api/v1/connectors/datasources/');
    expect(init.method).toBe('POST');
    expect(body).toEqual(payload);
  });

  it('reads and deletes one connection by id', async () => {
    await getDatasourceConnection(7);
    expect(lastCall().url).toBe('http://127.0.0.1:26866/api/v1/connectors/datasources/7');

    global.fetch = vi.fn(async () => ({ ok: true, status: 204, headers: { get: () => null } }));
    await deleteDatasourceConnection(7);
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('sends the revision it believes it is editing, and not the credential version', async () => {
    await editDatasourceConnection(7, { connector_id: 'postgres', password: 'new' }, 6);

    const { url, init, body } = lastCall();
    expect(url).toBe('http://127.0.0.1:26866/api/v1/connectors/datasources/7');
    expect(init.method).toBe('PATCH');
    expect(body.expected_revision).toBe(6);
    expect(body).not.toHaveProperty('expected_version');
  });

  it('retries a failed validation on its own route', async () => {
    await retryDatasourceValidation(7);

    const { url, init } = lastCall();
    expect(url).toBe('http://127.0.0.1:26866/api/v1/connectors/datasources/7/validation-retry');
    expect(init.method).toBe('POST');
  });

  it('refuses to call the relay outside org mode', async () => {
    setOrgMode(false);

    await expect(listDatasourceConnections()).rejects.toThrow(/cloud-only/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the relay error shape', () => {
  it('surfaces the message and keeps the code, instead of [object Object]', async () => {
    global.fetch = vi.fn(async () =>
      res({ detail: { code: 'invalid_connection', message: 'host must be reachable from the internet' } }, { ok: false, status: 400 }),
    );

    const error = await createDatasourceConnection({ connector_id: 'postgres' }).catch((e) => e);

    expect(error.message).toBe('host must be reachable from the internet');
    expect(error.code).toBe('invalid_connection');
    expect(error.status).toBe(400);
  });

  it('carries the code an edit conflict is only distinguishable by', async () => {
    global.fetch = vi.fn(async () =>
      res({ detail: { code: 'stale_version', message: 'this connection changed since you opened it' } }, { ok: false, status: 409 }),
    );

    const error = await editDatasourceConnection(7, {}, 2).catch((e) => e);

    expect(error.code).toBe('stale_version');
    expect(error.message).toBe('this connection changed since you opened it');
  });

  it('leaves the string and list detail shapes exactly as they were', async () => {
    global.fetch = vi.fn(async () => res({ detail: 'plain string detail' }, { ok: false, status: 400 }));
    await expect(listDatasourceConnections()).rejects.toThrow('plain string detail');

    global.fetch = vi.fn(async () =>
      res({ detail: [{ msg: 'field required' }, { msg: 'too long' }] }, { ok: false, status: 422 }),
    );
    await expect(listDatasourceConnections()).rejects.toThrow('field required, too long');
  });
});
