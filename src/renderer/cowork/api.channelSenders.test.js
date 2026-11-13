// The sender and pairing code calls match cowork-server's routes exactly, and a
// non-admin's refusal reads differently from a failed load.
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
  fetchChannelSenders,
  approveChannelSender,
  blockChannelSender,
  deleteChannelSender,
  createChannelPairingCode,
} from './api';

let originalFetch;
const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const SENDER = { id: 's1', channel_type: 'telegram', external_group_id: '42', external_sender_id: '7', is_group: false, status: 'pending' };

function lastCall() {
  const [url, opts] = global.fetch.mock.calls.at(-1);
  const parsed = new URL(String(url));
  return { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), method: (opts?.method || 'GET').toUpperCase() };
}

beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe('fetchChannelSenders', () => {
  it('asks for one status on one channel', async () => {
    global.fetch = vi.fn(async () => reply(200, [SENDER]));

    await expect(fetchChannelSenders({ status: 'pending', channelType: 'telegram' }))
      .resolves.toEqual({ senders: [SENDER], forbidden: false });
    expect(lastCall()).toEqual({
      path: '/api/v1/channels/senders', query: { status: 'pending', channel_type: 'telegram' }, method: 'GET',
    });
  });

  it('asks for every sender with no filter', async () => {
    global.fetch = vi.fn(async () => reply(200, []));

    await fetchChannelSenders();
    expect(lastCall()).toEqual({ path: '/api/v1/channels/senders', query: {}, method: 'GET' });
  });

  it('reads a refusal as forbidden, not as no senders', async () => {
    global.fetch = vi.fn(async () => reply(403, { detail: 'requires an org admin' }));

    await expect(fetchChannelSenders({ status: 'pending' })).resolves.toEqual({ senders: [], forbidden: true });
  });

  it('throws on a failed load instead of returning an empty list', async () => {
    global.fetch = vi.fn(async () => reply(500, { detail: 'boom' }));

    await expect(fetchChannelSenders({ status: 'pending' })).rejects.toMatchObject({ status: 500 });
  });
});

describe('sender actions and pairing codes', () => {
  it.each([
    ['approve', () => approveChannelSender('s 1'), '/api/v1/channels/senders/s%201/approve', 'POST'],
    ['block', () => blockChannelSender('s1'), '/api/v1/channels/senders/s1/block', 'POST'],
    ['delete', () => deleteChannelSender('s1'), '/api/v1/channels/senders/s1', 'DELETE'],
    ['pairing code', () => createChannelPairingCode('telegram'), '/api/v1/channels/telegram/pairing-codes', 'POST'],
  ])('%s calls its route', async (_name, call, path, method) => {
    global.fetch = vi.fn(async () => (method === 'DELETE' ? new Response(null, { status: 204 }) : reply(200, {})));

    await call();
    expect(lastCall()).toEqual({ path, query: {}, method });
  });

  it('passes a pairing code conflict to the caller', async () => {
    global.fetch = vi.fn(async () => reply(409, { detail: 'telegram already has 5 unused pairing codes' }));

    await expect(createChannelPairingCode('telegram')).rejects.toMatchObject({ status: 409 });
  });
});
