// Opening a conversation, and the refetch the app makes when a turn it watched
// leaves the server's in-flight list, both load saved turns through
// fetchSession. That replay must show the answer the live turn showed, not the
// saved content that joins every round: the reported ENG-4194 turn ended with
// Anton's opening line and its acknowledgement of the added message on top of
// its answer, which is exactly that saved content.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fixture from './__fixtures__/mid_turn_addon_stream.json';

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
vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn(), trackArtifactBuilt: vi.fn(), trackTokenCapHit: vi.fn() }));

import { fetchSession } from './api';
import { applySessionMessages } from './lib/conversationHistory';

const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
let originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const stubTurn = (assistant) => {
  originalFetch = global.fetch;
  global.fetch = vi.fn(async (url) => reply(String(url).includes('/items')
    ? [{ role: 'user', id: 'u1', content: 'NVIDIA past week dashboard' }, assistant]
    : { id: 'c1', title: 'T', project: null }));
};

describe('fetchSession — a finished turn shows the answer it showed live', () => {
  it('drops the narration the saved content carries (ENG-4194)', async () => {
    const events = fixture.mid_turn_hosted;
    const content = events.at(-1).response.output[0].content[0].text;
    stubTurn({ role: 'assistant', id: 'a1', content, events });
    const task = await fetchSession('c1');
    const answer = task.messages.find((m) => m.role === 'assistant');
    expect(answer.content.trim().startsWith('Updated the dashboard to cover the past six months.')).toBe(true);
    expect(answer.content).not.toContain('Assuming “past week”');
    expect(answer.content).not.toContain('Got it—using the last six calendar months');
    expect(answer.steps.filter((s) => s.badge === 'Note')).toHaveLength(2);
    // The refetch hands the page to applySessionMessages next; it keeps it.
    const applied = applySessionMessages('c1', task.messages, { skipLocalSidecar: true });
    expect(applied.find((m) => m.role === 'assistant').content).toBe(answer.content);
  });

  it('does the same for a turn nobody added a message to', async () => {
    const events = fixture.mid_turn_hosted.filter((e) => e.type !== 'response.addon');
    const content = events.at(-1).response.output[0].content[0].text;
    stubTurn({ role: 'assistant', id: 'a1', content, events });
    const task = await fetchSession('c1');
    const answer = task.messages.find((m) => m.role === 'assistant');
    expect(answer.content.trim().startsWith('Updated the dashboard to cover the past six months.')).toBe(true);
  });

  it('keeps the saved content when the events carry no text', async () => {
    stubTurn({ role: 'assistant', id: 'a1', content: 'Saved answer.', events: [
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.completed', response: { id: 'r1' } },
    ] });
    const task = await fetchSession('c1');
    expect(task.messages.find((m) => m.role === 'assistant').content).toBe('Saved answer.');
  });

  it('keeps the saved content of a turn that has not finished', async () => {
    stubTurn({ role: 'assistant', id: 'a1', content: 'Partial so far', events: [
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'Partial so far' },
    ] });
    const task = await fetchSession('c1');
    expect(task.messages.find((m) => m.role === 'assistant').content).toBe('Partial so far');
  });
});
