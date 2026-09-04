import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({
  serverStart: vi.fn(async () => ({ running: true })),
}));

vi.mock('../../platform/host', () => ({
  getApiOrigin: () => 'http://127.0.0.1:26866',
  isElectron: true,
  serverStart: hostMock.serverStart,
}));

import { codingApi, isCodingEvent, isTerminalPage, codingErrorCode } from './api';


beforeEach(() => {
  hostMock.serverStart.mockReset().mockResolvedValue({ running: true });
});

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

  it('starts the local service before creating a project without replaying the write', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'project-1', name: 'Project One' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await codingApi.createProject({
      name: 'Project One',
      resources: [],
      connections: [],
      environment: { variables: {}, port_names: [] },
      skill_sources: [],
      default_engine_id: 'codex',
      default_model: 'gpt-5.6-sol',
      permission_mode: 'supervised',
    });

    expect(hostMock.serverStart).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('recovers a failed read once after starting the local service', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(codingApi.projects()).resolves.toEqual({ items: [] });

    expect(hostMock.serverStart).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never replays a project write after an ambiguous network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(codingApi.createProject({
      name: 'Project One',
      resources: [],
      connections: [],
      environment: { variables: {}, port_names: [] },
      skill_sources: [],
      default_engine_id: 'codex',
      default_model: 'gpt-5.6-sol',
      permission_mode: 'supervised',
    })).rejects.toThrow('Failed to fetch');

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends live terminal input without restarting or resyncing the service', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'running', items: [], first_seq: 0, next_seq: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await codingApi.terminalInput('task-1', 'terminal-1', 'YQ==');
    await codingApi.resizeTerminal('task-1', 'terminal-1', 120, 40);

    expect(hostMock.serverStart).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it('names the head instruction when resuming a persisted queue', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'task-1' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await codingApi.runQueued('task-1', 'queue-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:26866/api/v1/coding/sessions/task-1/queue/run',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ instruction_id: 'queue-1' }) }),
    );
  });

  it('surfaces server detail and status without exposing an HTML error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Handoff stopped before changing the source' }),
    })));
    await expect(codingApi.apply('task-1')).rejects.toMatchObject({
      message: 'Handoff stopped before changing the source',
      status: 409,
    });
  });

  it('carries the error code the server names in a header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      headers: new Headers({ 'X-MindsHub-Error-Code': 'git_identity_missing' }),
      json: async () => ({ detail: 'Git needs your name and email before it can commit on this computer.' }),
    })));

    const failure = await codingApi.commit('task-1', 'Prepare change').catch((reason: unknown) => reason);

    expect(failure).toMatchObject({ status: 409, code: 'git_identity_missing' });
    expect(codingErrorCode(failure)).toBe('git_identity_missing');
    expect(codingErrorCode(new Error('plain'))).toBeUndefined();
  });

  it('explains the generic 404 produced by an incompatible backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not Found' }),
    })));

    await expect(codingApi.projects()).rejects.toThrow(
      'connected to an older backend that does not support Code Mode',
    );
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
    expect(isCodingEvent({ ...valid, type: 'command_result', phase: 'failed', data: { command: 'steer', commandId: 'cmd-1' } })).toBe(true);
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
