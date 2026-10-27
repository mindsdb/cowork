import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
const token = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example.test', getAccessToken: token, isWeb: true },
}));
import { BASE, fetchHubUsage, fetchHubWorkspaces, fetchSession, setActiveHubWorkspace, streamMessage, streamNewSession } from './api';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('blocks every hub API before credentials or network requests are read', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).includes('/workspaces')
      ? { enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null }
      : { reachable: false },
  ), { status: 200 }));
  expect(await fetchHubUsage()).toEqual({ reachable: false });
  expect(await fetchHubWorkspaces()).toEqual({
    enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null,
  });
  await expect(setActiveHubWorkspace('workspace')).rejects.toThrow('unavailable');
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

function completedResponse() {
  return new Response('data: {"type":"response.completed"}\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

it.each([
  ['new', null],
  ['continued', 'conversation-1'],
])('sends operator-controlled model and effort for a %s conversation', async (_kind, conversationId) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completedResponse());
  await new Promise((resolve, reject) => {
    const options = {
      model: 'caller-selected-model',
      reasoningEffort: 'high',
      projectName: 'reports',
      attachmentIds: ['file-1'],
      onDone: resolve,
      onError: reject,
    };
    if (conversationId) streamMessage(conversationId, 'Summarize sales', options);
    else streamNewSession('Summarize sales', options);
  });

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`${BASE}/responses`);
  const request = fetch.mock.calls[0][1];
  expect(request.method).toBe('POST');
  const body = JSON.parse(request.body);
  expect(body).toMatchObject({
    input: 'Summarize sales',
    model: null,
    conversation: conversationId,
    project: 'reports',
    attachment_ids: ['file-1'],
  });
  expect(body).not.toHaveProperty('reasoning_effort');
});

it('ignores a model restored from conversation metadata on the next question', async () => {
  const conversationId = 'saved-conversation';
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === `${BASE}/responses`) return completedResponse();
    if (String(url).startsWith(`${BASE}/conversations/${conversationId}/items?`)) {
      return new Response(JSON.stringify({ items: [{ role: 'user', content: 'Earlier question' }] }));
    }
    if (url === `${BASE}/conversations/${conversationId}`) {
      return new Response(JSON.stringify({ id: conversationId, model: 'saved-model', project: 'reports' }));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const task = await fetchSession(conversationId);
  expect(task?.model).toBe('saved-model');

  await new Promise((resolve, reject) => {
    streamMessage(task.id, 'Continue the report', {
      model: task.model,
      reasoningEffort: 'high',
      onDone: resolve,
      onError: reject,
    });
  });

  const request = fetch.mock.calls.find(([url]) => url === `${BASE}/responses`)[1];
  const body = JSON.parse(request.body);
  expect(body).toMatchObject({ model: null, conversation: conversationId });
  expect(body).not.toHaveProperty('reasoning_effort');
  expect(task.model).toBe('saved-model');
});
