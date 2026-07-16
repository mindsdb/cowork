import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __pollOnceForTest,
  __resetPollerForTest,
  buildObservedDigest,
  buildResultPayload,
  executeCommand,
  reportBridgeState,
  type PollerTransport,
} from './browser-command-poller';
import type { BrowserActionResult } from '../shared/browser-bridge-types';

// A fake /browse server that ENFORCES the real cowork-server request schemas
// (compat/stubs.py). Any request missing a required field or carrying a wrong
// enum form is rejected with a 422, exactly like FastAPI/pydantic would —
// so contract drift between the poller and the server fails these tests
// instead of only failing in production.
const SERVER_BRIDGE_STATES = ['disconnected', 'awaiting_approval', 'connected', 'lost'];
const SERVER_RESULT_CODES = [
  'ok',
  'timeout',
  'target_lost',
  'unapproved_tab',
  'permission_denied',
  'error',
];

class FakeBrowseServer {
  hello = 0;
  helloBodies: Record<string, unknown>[] = [];
  states: Record<string, unknown>[] = [];
  results: Record<string, unknown>[] = [];
  rejections: { path: string; detail: string }[] = [];
  sessionId = 'SESS-1';
  // Session ids the server no longer knows (restart / cleanup) — any
  // session-keyed call carrying one 404s, like the real server.
  staleSessionIds = new Set<string>();
  // Conversation ids the server can't resolve (temporary / never persisted)
  // — hello 404s "unknown conversation" (stubs.py:393-397).
  unknownConversationIds = new Set<string>();
  private nextCommands: unknown[] = [];

  queueCommand(cmd: unknown): void {
    this.nextCommands.push(cmd);
  }

  private reject(path: string, detail: string): Response {
    this.rejections.push({ path, detail });
    return errRes(422, detail);
  }

  fetch: typeof fetch = (async (url: string, init?: RequestInit) => {
    // The poller always calls through the /api/v1 prefix (cowork-server
    // mounts /browse/* under api_router = APIRouter(prefix="/api/v1")) — a
    // bare /browse/... 404s. Assert the prefix here so contract drift on the
    // prefix itself fails this test instead of only failing in production.
    const fullPath = new URL(url).pathname;
    if (!fullPath.startsWith('/api/v1/browse')) {
      return errRes(404, `unknown path ${fullPath} (missing /api/v1 prefix)`);
    }
    const path = fullPath.slice('/api/v1'.length);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/browse/bridge/hello') {
      // _BridgeHelloRequest: session_id OR conversation_id is required.
      if (!body.session_id && !body.conversation_id) {
        return this.reject(path, 'session_id or conversation_id is required');
      }
      if (body.session_id && this.staleSessionIds.has(String(body.session_id))) {
        return errRes(404, 'unknown session');
      }
      if (
        body.conversation_id &&
        this.unknownConversationIds.has(String(body.conversation_id))
      ) {
        return errRes(404, 'unknown conversation');
      }
      this.hello++;
      this.helloBodies.push(body);
      // _bridge_state_payload — carries the server-issued session_id.
      return jsonRes({
        session_id: this.sessionId,
        available: true,
        control_state: 'active',
        bridge_state: 'connected',
        requires_reapproval: false,
      });
    }
    if (path === '/browse/bridge/state') {
      // _BridgeStateRequest: {session_id, bridge_state} with underscore enum.
      if (!body.session_id) return this.reject(path, 'session_id is required');
      if (!SERVER_BRIDGE_STATES.includes(body.bridge_state)) {
        return this.reject(path, `invalid bridge_state: ${body.bridge_state}`);
      }
      if (this.staleSessionIds.has(String(body.session_id))) {
        return errRes(404, 'unknown session');
      }
      this.states.push(body);
      return jsonRes({ session_id: body.session_id, bridge_state: body.bridge_state });
    }
    if (path === '/browse/commands/next') {
      // _CommandsNextRequest: session_id is required.
      if (!body.session_id) return this.reject(path, 'session_id is required');
      if (this.staleSessionIds.has(String(body.session_id))) {
        return errRes(404, 'unknown session');
      }
      const cmd = this.nextCommands.shift() ?? null;
      return jsonRes({ command: cmd });
    }
    if (path.startsWith('/browse/commands/') && path.endsWith('/result')) {
      // BridgeCommandResult: {command_id, result_code} with the internal enum.
      if (!body.command_id) return this.reject(path, 'command_id is required');
      if (!SERVER_RESULT_CODES.includes(body.result_code)) {
        return this.reject(path, `invalid result_code: ${body.result_code}`);
      }
      this.results.push(body);
      return jsonRes({ resolved: true, command_id: body.command_id });
    }
    return errRes(404, `unknown path ${path}`);
  }) as unknown as typeof fetch;
}

function jsonRes(obj: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => obj,
  } as unknown as Response;
}

function errRes(status: number, detail: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ detail }),
  } as unknown as Response;
}

const transport: PollerTransport = {
  origin: () => 'http://127.0.0.1:26866',
  authHeader: () => ({}),
};

// A fake bridge exec that starts connected and returns canned results.
function fakeExec(overrides: Partial<Record<string, unknown>> = {}) {
  const okResult: BrowserActionResult = {
    status: 'ok',
    action: 'inspect',
    observed: {
      url: 'https://shop.example.com/report',
      title: 'secret title',
      links: [{ text: 'a', href: 'https://shop.example.com/a' }],
    },
  };
  return {
    inspect: vi.fn(async () => okResult),
    navigateApprovedLink: vi.fn(async () => ({ ...okResult, action: 'navigate' as const })),
    scroll: vi.fn(async () => ({ ...okResult, action: 'scroll' as const })),
    wait: vi.fn(async () => ({ ...okResult, action: 'wait' as const })),
    currentState: vi.fn(() => 'connected' as const),
    status: vi.fn(() => ({ available: true, state: 'connected' as const, domain: 'shop.example.com' })),
    conversationId: vi.fn(() => 'CONV-1'),
    stopRequestedSince: vi.fn(() => false),
    clearStopRequest: vi.fn(),
    ...overrides,
  };
}

// A stateful fake of the bridge's Stop latch (timestamped, self-clearing) so
// tests exercise the real latch lifecycle instead of a canned boolean.
function fakeStopLatch() {
  let stopRequestedAt: number | null = null;
  return {
    requestStop(at: number = Date.now()): void {
      stopRequestedAt = at;
    },
    isSet(): boolean {
      return stopRequestedAt !== null;
    },
    stopRequestedSince: vi.fn((sinceMs: number) => stopRequestedAt !== null && stopRequestedAt >= sinceMs),
    clearStopRequest: vi.fn(() => {
      stopRequestedAt = null;
    }),
  };
}

beforeEach(() => {
  __resetPollerForTest();
});
afterEach(() => {
  __resetPollerForTest();
});

describe('browser-command-poller', () => {
  it('sends a conversation-scoped hello, then executes a queued command and posts the result', async () => {
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C1', action_type: 'inspect', session_id: 'SESS-1' });
    const exec = fakeExec();

    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch });
    expect(outcome).toBe('command');
    expect(server.rejections).toEqual([]);
    expect(server.hello).toBe(1);
    // Exact hello body: identity + approved host-only domain.
    expect(server.helloBodies[0]).toEqual({
      os: process.platform,
      conversation_id: 'CONV-1',
      domain: 'shop.example.com',
    });
    expect(exec.inspect).toHaveBeenCalled();
    expect(server.results).toHaveLength(1);
    expect(server.results[0].command_id).toBe('C1');
    // Server BridgeCommandResult schema: result_code (internal enum), not status.
    expect(server.results[0].result_code).toBe('ok');
    expect(server.results[0]).not.toHaveProperty('status');
  });

  it('keys /commands/next by the session_id learned from the hello response', async () => {
    const server = new FakeBrowseServer();
    server.sessionId = 'SESS-42';
    let nextBody: Record<string, unknown> | null = null;
    const origFetch = server.fetch;
    server.fetch = (async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/v1/browse/commands/next') {
        nextBody = init?.body ? JSON.parse(String(init.body)) : {};
      }
      return origFetch(url, init);
    }) as unknown as typeof fetch;

    await __pollOnceForTest({ transport, exec: fakeExec(), fetchImpl: server.fetch });
    expect(server.rejections).toEqual([]);
    expect(nextBody).toEqual({ session_id: 'SESS-42' });
  });

  it('posts an observed blob that carries the content-free digest keys', async () => {
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C2', action_type: 'inspect', session_id: 'SESS-1' });
    await __pollOnceForTest({ transport, exec: fakeExec(), fetchImpl: server.fetch });
    const observed = server.results[0].observed as Record<string, unknown>;
    // The digest keys the server's build_observed_digest persists.
    expect(observed.final_domain).toBe('example.com');
    expect(observed.link_count).toBe(1);
    expect(observed.settled).toBe(true);
    // The transient answer-path payload is still present (server keeps it
    // transient; only the digest is persisted).
    expect(observed.title).toBe('secret title');
  });

  it('does no work (no hello) while the bridge is not connected', async () => {
    const server = new FakeBrowseServer();
    const exec = fakeExec({ currentState: vi.fn(() => 'disconnected' as const) });
    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch });
    expect(outcome).toBe('idle');
    expect(server.hello).toBe(0);
  });

  it('stays idle (never sends an anonymous hello) when no conversation is bound', async () => {
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C3', action_type: 'inspect', session_id: 'SESS-1' });
    const exec = fakeExec({ conversationId: vi.fn(() => null) });
    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch });
    // An anonymous hello would 422 — the poller must not send one.
    expect(outcome).toBe('idle');
    expect(server.hello).toBe(0);
    expect(server.rejections).toEqual([]);
    expect(exec.inspect).not.toHaveBeenCalled();
  });

  it('gates a handed-out command when Stop/Take-over lands before execution', async () => {
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C-STOP', action_type: 'inspect', session_id: 'SESS-1' });
    // The bridge is connected at hello/next time, but a Take-over detaches it
    // right after the command is handed out: currentState flips to disconnected
    // on the post-hand-out re-check. Sequence: hello(connected) →
    // guard-after-hello(connected) → post-next re-check(disconnected).
    const states = ['connected', 'connected', 'disconnected', 'disconnected'];
    let i = 0;
    const exec = fakeExec({
      currentState: vi.fn(() => (states[Math.min(i++, states.length - 1)] as 'connected' | 'disconnected')),
      status: vi.fn(() => ({ available: false, state: 'disconnected' as const })),
    });

    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch });
    // No new action executed after the stop landed.
    expect(exec.inspect).not.toHaveBeenCalled();
    expect(outcome).toBe('idle');
    expect(server.rejections).toEqual([]);
    // The server still receives a result so it isn't left waiting —
    // bridge_disconnected maps to the internal `timeout` code.
    expect(server.results).toHaveLength(1);
    expect(server.results[0].command_id).toBe('C-STOP');
    expect(server.results[0].result_code).toBe('timeout');
    // And the gated bridge state report uses the required schema.
    expect(server.states).toHaveLength(1);
    expect(server.states[0]).toEqual({ session_id: 'SESS-1', bridge_state: 'disconnected' });
  });

  it('gates a raced command (Stop landed while the long-poll was outstanding) and clears the latch', async () => {
    // Guarantee (a) Stop <1s: Stop, unlike Take-over, does NOT detach the
    // local bridge — currentState() stays 'connected'. A command the server
    // handed to the wire just before the Stop landed must still be refused:
    // the stop fires DURING the outstanding /commands/next long-poll, i.e.
    // after pollStartedAt, so the latch gates it.
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C-RACED', action_type: 'inspect', session_id: 'SESS-1' });
    const latch = fakeStopLatch();
    const baseFetch = server.fetch;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      // The Stop lands while this long-poll is on the wire — the raced case.
      if (new URL(url).pathname.endsWith('/browse/commands/next')) latch.requestStop();
      return baseFetch(url, init);
    }) as unknown as typeof fetch;
    const exec = fakeExec({
      stopRequestedSince: latch.stopRequestedSince,
      clearStopRequest: latch.clearStopRequest,
    });

    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl });
    expect(outcome).toBe('idle');
    expect(server.rejections).toEqual([]);
    // The action never ran — the latch gated it despite the connected bridge.
    expect(exec.inspect).not.toHaveBeenCalled();
    // The server still gets a result so it isn't left waiting.
    expect(server.results).toHaveLength(1);
    expect(server.results[0].command_id).toBe('C-RACED');
    expect(server.results[0].result_code).toBe('timeout');
    // The latch's raced-case job is done: it is cleared, never persisting
    // to gate a later (post-resume) command.
    expect(latch.clearStopRequest).toHaveBeenCalled();
    expect(latch.isSet()).toBe(false);
  });

  it('executes a post-resume command normally when the Stop predates the poll', async () => {
    // The SERVER is the stop/resume authority: it resumes stopped → active
    // on a fresh user turn. A poll that STARTED after the Stop can only
    // return a command a resumed server handed out — the stale local latch
    // must not gate it (the old boolean latch did, refusing every command
    // as bridge_disconnected until re-approval).
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C-RESUMED', action_type: 'inspect', session_id: 'SESS-1' });
    const latch = fakeStopLatch();
    latch.requestStop(Date.now() - 50); // Stop pressed well before this poll starts
    const exec = fakeExec({
      stopRequestedSince: latch.stopRequestedSince,
      clearStopRequest: latch.clearStopRequest,
    });

    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch });
    expect(outcome).toBe('command');
    expect(server.rejections).toEqual([]);
    // The command executed normally and reported ok.
    expect(exec.inspect).toHaveBeenCalled();
    expect(server.results).toHaveLength(1);
    expect(server.results[0].command_id).toBe('C-RESUMED');
    expect(server.results[0].result_code).toBe('ok');
    // The stale latch was cleared.
    expect(latch.isSet()).toBe(false);
  });

  it('a Stop with no new turn stays stopped: the server hands out nothing and clearing the latch runs nothing', async () => {
    // Guarantee (b): after Stop with NO subsequent user turn the server gate
    // (the single source of truth) hands out no commands. The post-stop poll
    // returns empty, the stale local latch is dropped (it never persists
    // across poll cycles once a post-stop poll completed), and nothing runs.
    const server = new FakeBrowseServer(); // nothing queued — server is stopped
    const latch = fakeStopLatch();
    latch.requestStop(Date.now() - 50);
    const exec = fakeExec({
      stopRequestedSince: latch.stopRequestedSince,
      clearStopRequest: latch.clearStopRequest,
    });

    const outcome = await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch });
    expect(outcome).toBe('idle');
    expect(server.rejections).toEqual([]);
    // Nothing executed, nothing reported — stopped stays stopped.
    expect(exec.inspect).not.toHaveBeenCalled();
    expect(server.results).toHaveLength(0);
    // The latch never persists once a post-stop poll completed.
    expect(latch.isSet()).toBe(false);

    // A later cycle (e.g. after a server-side resume) is not gated by any
    // leftover latch state.
    server.queueCommand({ command_id: 'C-AFTER', action_type: 'inspect', session_id: 'SESS-1' });
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('command');
    expect(server.results[0].result_code).toBe('ok');
  });

  it('starts polling once a conversation becomes active after a null-at-approval', async () => {
    // Approval with no active conversation binds null; the poller must idle
    // (never an anonymous hello) but pick up the conversation as soon as the
    // renderer's App-level sync pushes one — not stay unusable forever.
    const server = new FakeBrowseServer();
    server.queueCommand({ command_id: 'C-LATE', action_type: 'inspect', session_id: 'SESS-1' });
    let conv: string | null = null;
    const exec = fakeExec({ conversationId: vi.fn(() => conv) });

    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('idle');
    expect(server.hello).toBe(0);

    conv = 'CONV-LATE'; // a conversation becomes active later
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('command');
    expect(server.rejections).toEqual([]);
    expect(server.helloBodies[0]).toMatchObject({ conversation_id: 'CONV-LATE' });
    expect(server.results[0].command_id).toBe('C-LATE');
  });

  it('recovers from a temp/unknown conversation 404 once the canonical id is adopted', async () => {
    // A temp (never persisted) conversation id 404s at hello. The poller must
    // not cache any state off that failure: when the renderer re-syncs the
    // canonical id (tmp→server id adoption), the next cycle hellos with it.
    const server = new FakeBrowseServer();
    server.unknownConversationIds.add('tmp-123');
    server.queueCommand({ command_id: 'C-ADOPT', action_type: 'inspect', session_id: 'SESS-1' });
    let conv = 'tmp-123';
    const exec = fakeExec({ conversationId: vi.fn(() => conv) });

    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('error');
    expect(server.hello).toBe(0);

    conv = 'CONV-CANONICAL'; // renderer adopted the server-issued id
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('command');
    expect(server.rejections).toEqual([]);
    expect(server.helloBodies[0]).toMatchObject({ conversation_id: 'CONV-CANONICAL' });
    expect(server.results[0].command_id).toBe('C-ADOPT');
  });

  it('drops a stale session on /commands/next 404 and re-hellos via the conversation', async () => {
    // Server restart / session cleanup: the session id the poller carries
    // 404s on the session-keyed endpoints. The poller must clear the binding
    // and recover through a fresh conversation-scoped hello, not error forever.
    const server = new FakeBrowseServer();
    const exec = fakeExec();

    // Cycle 1: hello establishes SESS-1.
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('idle');
    expect(server.hello).toBe(1);

    // The server forgets the session; the next /commands/next 404s.
    server.staleSessionIds.add('SESS-1');
    server.sessionId = 'SESS-2';
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('error');

    // Cycle 3: re-hello with the conversation identity, new session works.
    server.queueCommand({ command_id: 'C-RECOVER', action_type: 'inspect', session_id: 'SESS-2' });
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('command');
    expect(server.rejections).toEqual([]);
    expect(server.hello).toBe(2);
    expect(server.helloBodies[1]).toMatchObject({ conversation_id: 'CONV-1' });
    expect(server.results[0].command_id).toBe('C-RECOVER');
  });

  it('re-hellos with the NEW conversation when the active conversation switches', async () => {
    // A session is conversation-scoped: once established under task A, a
    // switch to task B must invalidate it — otherwise the poller would keep
    // long-polling A's session while the renderer works in B.
    const server = new FakeBrowseServer();
    let conv = 'CONV-A';
    const exec = fakeExec({ conversationId: vi.fn(() => conv) });

    // Cycle 1: establish SESS-1 under conversation A.
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('idle');
    expect(server.helloBodies[0]).toMatchObject({ conversation_id: 'CONV-A' });

    // The user switches to task B; the server issues a new session for it.
    conv = 'CONV-B';
    server.sessionId = 'SESS-B';
    server.queueCommand({ command_id: 'C-B', action_type: 'inspect', session_id: 'SESS-B' });
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('command');
    expect(server.rejections).toEqual([]);
    expect(server.hello).toBe(2);
    expect(server.helloBodies[1]).toMatchObject({ conversation_id: 'CONV-B' });
    expect(server.results[0].command_id).toBe('C-B');
  });

  it('stops polling the old session when the conversation clears to null', async () => {
    // Task A → home/null: the poller must drop A's session and idle — not
    // keep pulling /commands/next for a conversation that is no longer active.
    const server = new FakeBrowseServer();
    let conv: string | null = 'CONV-A';
    const exec = fakeExec({ conversationId: vi.fn(() => conv) });
    let nextCalls = 0;
    const origFetch = server.fetch;
    server.fetch = (async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/v1/browse/commands/next') nextCalls++;
      return origFetch(url, init);
    }) as unknown as typeof fetch;

    // Establish SESS-1 under A (hello + one /commands/next poll).
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('idle');
    expect(nextCalls).toBe(1);

    // Conversation cleared: session invalidated, poller idles with NO
    // further /commands/next and NO anonymous hello.
    conv = null;
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('idle');
    expect(nextCalls).toBe(1);
    expect(server.hello).toBe(1);
    expect(server.rejections).toEqual([]);
  });

  it('drops a stale session when reportBridgeState 404s so the next cycle re-hellos', async () => {
    const server = new FakeBrowseServer();
    const exec = fakeExec();

    // Establish SESS-1, then have the server forget it.
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('idle');
    server.staleSessionIds.add('SESS-1');
    server.sessionId = 'SESS-2';

    // A state report into the forgotten session 404s — binding cleared.
    await reportBridgeState();

    // Next cycle re-hellos with the conversation identity and gets SESS-2.
    server.queueCommand({ command_id: 'C-STATE-404', action_type: 'inspect', session_id: 'SESS-2' });
    expect(await __pollOnceForTest({ transport, exec, fetchImpl: server.fetch })).toBe('command');
    expect(server.rejections).toEqual([]);
    expect(server.hello).toBe(2);
    expect(server.results[0].command_id).toBe('C-STATE-404');
  });

  it('maps each action_type to the right primitive', async () => {
    const exec = fakeExec();
    // wire cfg via a poll then call executeCommand directly
    await __pollOnceForTest({ transport, exec, fetchImpl: new FakeBrowseServer().fetch });
    await executeCommand({ command_id: 'x', action_type: 'navigate', href: 'https://shop.example.com/a' });
    await executeCommand({ command_id: 'y', action_type: 'scroll', direction: 'up' });
    await executeCommand({ command_id: 'z', action_type: 'wait', wait_ms: 5 });
    expect(exec.navigateApprovedLink).toHaveBeenCalledWith('https://shop.example.com/a');
    expect(exec.scroll).toHaveBeenCalledWith('up');
    expect(exec.wait).toHaveBeenCalledWith(5);
  });
});

describe('buildResultPayload', () => {
  it('maps external statuses to the server-internal result_code enum', () => {
    const cases: Array<[BrowserActionResult['status'], string]> = [
      ['ok', 'ok'],
      ['permission_denied', 'permission_denied'],
      ['tab_closed', 'target_lost'],
      ['bridge_disconnected', 'timeout'],
      ['navigation_failed', 'error'],
      ['unsupported_action', 'error'],
    ];
    for (const [status, expected] of cases) {
      const payload = buildResultPayload('C', { status, action: 'inspect' });
      expect(payload.result_code).toBe(expected);
    }
  });

  it('omits observed on non-ok results and carries reason as detail', () => {
    const payload = buildResultPayload('C', {
      status: 'navigation_failed',
      action: 'navigate',
      reason: 'nope',
      observed: { url: 'https://x.example.com/p' },
    });
    expect(payload).toEqual({ command_id: 'C', result_code: 'error', detail: 'nope' });
  });
});

describe('buildObservedDigest', () => {
  it('allowlists only content-free keys', () => {
    const digest = buildObservedDigest(
      {
        url: 'https://example.com/secret/path?q=1',
        title: 'Secret',
        text: 'body text',
        links: [{ text: 't', href: 'https://example.com/x' }],
      },
      'ok',
    );
    expect(Object.keys(digest).sort()).toEqual(['final_domain', 'link_count', 'settled']);
    expect(digest.final_domain).toBe('example.com');
  });
});
