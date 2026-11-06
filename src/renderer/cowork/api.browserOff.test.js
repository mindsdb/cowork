// A task with the composer's Browser switch off asks for `browser: "off"` on
// every send (ENG-3188); any other task sends no key at all, so an older
// server never sees it.
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { streamMessage, streamNewSession } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

async function questionBody(conversationId, options) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    'data: {"type":"response.completed"}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  ));
  await new Promise((resolve, reject) => {
    const all = { ...options, onDone: resolve, onError: reject };
    if (conversationId) streamMessage(conversationId, 'Book a hotel', all);
    else streamNewSession('Book a hotel', all);
  });
  return JSON.parse(fetch.mock.calls[0][1].body);
}

it.each([
  ['new', null],
  ['continued', 'conversation-1'],
])('asks for no browser for a %s task with it switched off', async (_kind, conversationId) => {
  expect(await questionBody(conversationId, { browserOff: true })).toMatchObject({ browser: 'off' });
});

it('sends no browser key otherwise', async () => {
  expect(await questionBody('conversation-1', {})).not.toHaveProperty('browser');
  expect(await questionBody(null, { browserOff: false })).not.toHaveProperty('browser');
});
