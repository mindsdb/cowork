// A send needs no typing (a retry, a suggested prompt), so the send itself
// has to hold off the organization landing reload.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { streamMessage, streamNewSession } from './api';
import { __resetWorkStartedForTests, hasWorkStarted } from './lib/documentWork';

beforeEach(() => __resetWorkStartedForTests());
afterEach(() => vi.restoreAllMocks());

it.each([
  ['new', null],
  ['continued', 'conversation-1'],
])('counts sending to a %s task as work started', async (_kind, conversationId) => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    'data: {"type":"response.completed"}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  ));
  expect(hasWorkStarted()).toBe(false);
  await new Promise((resolve, reject) => {
    const options = { onDone: resolve, onError: reject };
    if (conversationId) streamMessage(conversationId, 'Book a hotel', options);
    else streamNewSession('Book a hotel', options);
  });
  expect(hasWorkStarted()).toBe(true);
});
