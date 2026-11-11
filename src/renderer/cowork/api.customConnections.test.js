// Connecting a custom connector, and listing and removing its connections:
// cloud only, each on its own route.

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { BASE, connectCustomConnector, deleteCustomConnection, listCustomConnections } from './api';
import { setOrgMode } from '../lib/orgMode';

beforeEach(() => {
  setOrgMode(true);
});

afterEach(() => {
  setOrgMode(false);
  vi.restoreAllMocks();
});

function answer(status, body) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } },
  ));
}

it('posts the connect request to the connector’s own route', async () => {
  const fetch = answer(201, { id: 7 });
  const payload = { name: 'Acme', address: 'api.acme.example', values: { api_key: 'k' } };

  await connectCustomConnector('acme_crm', payload);

  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/connectors/custom/acme_crm/connect`);
  expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
});

it('reads a failed check’s code and detail off the refusal', async () => {
  answer(422, { detail: { code: 'authentication_failed', provider_status: 401, excerpt: 'no' } });

  const err = await connectCustomConnector('acme_crm', {}).catch((e) => e);

  expect(err.status).toBe(422);
  expect(err.code).toBe('authentication_failed');
  expect(err.body.detail.excerpt).toBe('no');
});

it('lists and deletes on the custom connections relay', async () => {
  const fetch = answer(200, []);

  await listCustomConnections();
  await deleteCustomConnection(7);

  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/connectors/custom-connections/`);
  expect(fetch.mock.calls[1][0]).toBe(`${BASE}/connectors/custom-connections/7`);
  expect(fetch.mock.calls[1][1].method).toBe('DELETE');
});

it('asks nothing on desktop', async () => {
  setOrgMode(false);
  const fetch = answer(200, []);

  await expect(connectCustomConnector('acme_crm', {})).rejects.toThrow(/cloud-only/);
  await expect(listCustomConnections()).rejects.toThrow(/cloud-only/);
  await expect(deleteCustomConnection(7)).rejects.toThrow(/cloud-only/);
  expect(fetch).not.toHaveBeenCalled();
});
