// Saving a connector template, and asking whether it is already saved.

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { BASE, fetchConnectorDraftSaved, saveConnectorDraft } from './api';
import drafted from './lib/__fixtures__/connectorDrafted.json';

afterEach(() => {
  vi.restoreAllMocks();
});

function answer(status, body) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } },
  ));
}

it('posts the template unchanged to the custom connectors route', async () => {
  const fetch = answer(200, { id: 'acme_crm', custom: true });

  await saveConnectorDraft(drafted.connector);

  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/connectors/custom`);
  expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(drafted.connector);
});

it.each([
  [200, { id: 'acme_crm', custom: true }, true],
  [200, { id: 'acme_crm', custom: false }, false],
  [404, { detail: 'Connector not found.' }, false],
  [500, { detail: 'nope' }, null],
])('reads a %s spec lookup as saved=%s', async (status, body, expected) => {
  const fetch = answer(status, body);

  await expect(fetchConnectorDraftSaved('acme_crm')).resolves.toBe(expected);
  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/connectors/specs/acme_crm`);
});
