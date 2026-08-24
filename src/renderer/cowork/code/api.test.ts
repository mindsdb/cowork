import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', () => ({ getApiOrigin: () => 'http://127.0.0.1:26866' }));

import { codingApi, isCodingEvent, isTerminalPage } from './api';


afterEach(() => vi.unstubAllGlobals());


describe('coding API boundary', () => {
  it('encodes Windows paths as query data rather than URL structure', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ exists: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await codingApi.inspect('C:\\Users\\Ian & Team\\repo');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:26866/api/v1/coding/workspace/inspect?path=C%3A%5CUsers%5CIan%20%26%20Team%5Crepo',
    );
  });

  it('accepts an empty 204 response when deleting a local task', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })));
    await expect(codingApi.deleteSession('task-1')).resolves.toBeUndefined();
  });

  it('promotes an exact queued instruction without resending its text from the renderer', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'task-1', queued_instructions: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await codingApi.steerQueued('task/1', 'queue 1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:26866/api/v1/coding/sessions/task%2F1/queue/queue%201/steer',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces server detail without exposing an HTML error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Handoff stopped before changing the source' }),
    })));
    await expect(codingApi.apply('task-1')).rejects.toThrow('Handoff stopped before changing the source');
  });

  it('rejects malformed event frames at the renderer boundary', () => {
    const valid = {
      schema_version: 1,
      seq: 1,
      timestamp: '2026-08-21T00:00:00Z',
      type: 'agent_message',
      title: 'Codex',
      text: 'done',
      phase: 'progress',
      data: {},
    };
    expect(isCodingEvent(valid)).toBe(true);
    expect(isCodingEvent({ ...valid, type: 'vendor-internal' })).toBe(false);
    expect(isCodingEvent({ ...valid, data: [] })).toBe(false);
    expect(isCodingEvent({ ...valid, seq: '1' })).toBe(false);
    expect(isCodingEvent(null)).toBe(false);
  });

  it('requires a complete, validated terminal state frame', () => {
    const valid = {
      process_id: 'terminal-1',
      status: 'running',
      items: [{
        seq: 1,
        data_base64: 'b2s=',
        stream: 'stdout',
        cap_reached: false,
        timestamp: '2026-08-22T10:00:00Z',
      }],
      first_seq: 1,
      next_seq: 1,
      exit_code: null,
      error: null,
    };
    expect(isTerminalPage(valid)).toBe(true);
    expect(isTerminalPage({ ...valid, items: undefined })).toBe(false);
    expect(isTerminalPage({ ...valid, first_seq: '1' })).toBe(false);
    expect(isTerminalPage({ ...valid, items: [{ ...valid.items[0], stream: 'unknown' }] })).toBe(false);
  });
});
