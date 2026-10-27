import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: vi.fn(async () => null), isWeb: true },
}));
import { BASE, streamMessage, streamNewSession } from './api';
import { MODEL_ROUTER_ID } from './lib/modelCatalog';

beforeEach(() => {
  vi.clearAllMocks();
  const meta = document.createElement('meta');
  meta.name = 'cowork-model-picker';
  meta.content = 'default';
  document.head.append(meta);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('meta[name^="cowork-model-"]').forEach((node) => node.remove());
});

async function questionBody(conversationId, options) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
    'data: {"type":"response.completed"}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  ));
  await new Promise((resolve, reject) => {
    const all = { ...options, onDone: resolve, onError: reject };
    if (conversationId) streamMessage(conversationId, 'Summarize sales', all);
    else streamNewSession('Summarize sales', all);
  });
  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/responses`);
  return JSON.parse(fetch.mock.calls[0][1].body);
}

it.each([
  ['new', null],
  ['continued', 'conversation-1'],
])('sends the picked model for a %s conversation, and no effort the operator offers no one', async (_kind, conversationId) => {
  const body = await questionBody(conversationId, { model: 'opus-5-5', reasoningEffort: 'high' });
  expect(body).toMatchObject({ model: 'opus-5-5', conversation: conversationId });
  expect(body).not.toHaveProperty('reasoning_effort');
});

it("sends no model for the operator's own row", async () => {
  const body = await questionBody('conversation-1', { model: MODEL_ROUTER_ID });
  expect(body.model).toBeNull();
});

function offerEfforts() {
  const meta = document.createElement('meta');
  meta.name = 'cowork-model-efforts';
  meta.content = JSON.stringify({ models: { 'opus-5-5': ['xhigh'], 'gpt-5.6-luna': ['low'] }, operatorDefault: ['low'] });
  document.head.append(meta);
}

it.each([
  ['the picked model', 'opus-5-5', 'xhigh', 'opus-5-5'],
  ["the operator's own row", MODEL_ROUTER_ID, 'low', null],
  ['no model', null, 'low', null],
])('sends an effort the operator lets users pick on %s', async (_kind, model, effort, sent) => {
  offerEfforts();
  const body = await questionBody('conversation-1', { model, reasoningEffort: effort });
  expect(body).toMatchObject({ model: sent, reasoning_effort: effort });
});

it.each([
  // max is an effort the route may take on opus-5-5, but not one the operator offers.
  ['opus-5-5', 'max'],
  // low is offered on gpt-5.6-luna and with no model, not on opus-5-5.
  ['opus-5-5', 'low'],
  [MODEL_ROUTER_ID, 'xhigh'],
  ['claude-haiku-5-5', 'low'],
])('sends no effort the operator does not offer on the model it sends: %s at %s', async (model, effort) => {
  offerEfforts();
  const body = await questionBody('conversation-1', { model, reasoningEffort: effort });
  expect(body).not.toHaveProperty('reasoning_effort');
});
