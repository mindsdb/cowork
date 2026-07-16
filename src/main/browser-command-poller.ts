// Server↔main command poller (Browser Control M1, WS1-T6).
//
// Closes the transport-ownership gap: cowork-server is the command authority
// (it enqueues browser commands the agent tool requests); the Electron main
// process is the bridge OWNER (it holds the CDP socket and executes). This
// poller is the pump that connects them:
//
//   on bridge `connected`  → POST /browse/bridge/hello
//   loop                   → POST /browse/commands/next  (long-poll)
//                          → map action_type → WS1 primitive, execute
//                          → POST /browse/commands/{id}/result
//   on attach/lost/nav     → POST /browse/bridge/state   (server flips
//                            `available`, detects tab-close/Chrome-restart)
//
// Bounded backoff, single in-flight poll, clean stop on shutdown. The
// transient `observed` (answer/citation path) is returned to the agent via
// the tool result the SERVER assembles; the poster only sends the content-free
// external result code + observed digest fields WS4 persists.

import {
  currentState,
  status as bridgeStatus,
  inspect,
  navigateApprovedLink,
  scroll,
  wait,
  onBridgeStateChange,
  getConversationId,
  isStopRequestedSince,
  clearStopRequest,
} from './browser-bridge';
import {
  registrableHost,
  toInternalResultCode,
  toServerBridgeState,
  type BrowserActionResult,
  type InternalResultCode,
  type ObservedResult,
} from '../shared/browser-bridge-types';

// A command handed down by cowork-server (schemas/browser.py BridgeCommand).
// `action_type` is the stored type (inspect/navigate/scroll/wait); the server
// never sends the LLM verb. Arrives wrapped: `POST /browse/commands/next`
// responds `{ command: BridgeCommand | null, blocked?: string }`.
export interface BridgeCommand {
  command_id: string;
  action_type: 'inspect' | 'navigate' | 'scroll' | 'wait';
  session_id?: string;
  conversation_id?: string | null;
  domain?: string | null;
  href?: string | null;
  direction?: 'down' | 'up' | null;
  wait_ms?: number;
}

// What the poster sends back — EXACTLY cowork-server's BridgeCommandResult
// schema (`{command_id, result_code, observed?, detail?}`). `result_code` is
// the server-INTERNAL enum (toInternalResultCode), not the external status.
// `observed` carries the transient extraction for the answer path, merged with
// the content-free digest keys (final_domain/link_count/settled) the server's
// build_observed_digest persists.
export interface BridgeCommandResult {
  command_id: string;
  result_code: InternalResultCode;
  observed?: Record<string, unknown>;
  detail?: string;
}

// Injected transport so tests drive a fake /browse server (network is denied
// in the test env). Each function is a thin HTTP call in production.
export interface PollerTransport {
  // Server base URL + auth header, resolved lazily (port/token settle at boot).
  origin(): string;
  authHeader(): Record<string, string>;
}

type ExecFns = {
  inspect: typeof inspect;
  navigateApprovedLink: typeof navigateApprovedLink;
  scroll: typeof scroll;
  wait: typeof wait;
  currentState: typeof currentState;
  status: typeof bridgeStatus;
  // The active conversation id the renderer keeps synced into main
  // (bridge/hello requires a conversation_id — or a prior session_id — to
  // identify the session; the server 422s an anonymous hello).
  conversationId: typeof getConversationId;
  // Local user-Stop latch (set via IPC BROWSER_STOP, timestamped). Checked
  // pre-execution AGAINST THE POLL START TIME so a command handed out just
  // before the Stop landed is gated even though the local bridge stays
  // connected (Stop, unlike Take-over, does not detach). Never gates a
  // command from a poll that started after the stop — the server (the
  // stop/resume authority) already had its gate set and then resumed.
  stopRequestedSince: typeof isStopRequestedSince;
  clearStopRequest: typeof clearStopRequest;
};

interface PollerConfig {
  transport?: PollerTransport;
  exec?: ExecFns;
  // Poll interval / backoff knobs (ms).
  idleDelayMs?: number;
  maxBackoffMs?: number;
  // fetch impl (defaults to global fetch).
  fetchImpl?: typeof fetch;
}

let running = false;
let stopped = true;
let inFlight = false;
let cfg: Required<Omit<PollerConfig, 'transport' | 'exec' | 'fetchImpl'>> & {
  transport?: PollerTransport;
  exec: ExecFns;
  fetchImpl: typeof fetch;
};
let helloSent = false;
// The server-issued BrowserSession id, learned from the `/browse/bridge/hello`
// response (`_bridge_state_payload.session_id`). Every session-keyed endpoint
// (`/commands/next`, `/bridge/state`) requires it — until hello succeeds we
// skip those calls rather than send a body the server would 422.
let sessionId: string | null = null;
// The conversation the current `sessionId` was established under. Sessions
// are conversation-scoped server-side, so when the renderer re-syncs a
// DIFFERENT active conversation (task switch, tmp→canonical adoption) or
// clears it (home/null), the session binding is stale: keeping it would leave
// the poller long-polling the OLD conversation's session indefinitely.
let sessionConversationId: string | null = null;

// Drop the session binding entirely (server forgot it, teardown, or the
// conversation it belonged to is no longer active).
function clearSession(): void {
  sessionId = null;
  sessionConversationId = null;
  helloSent = false;
}

// Drop the session binding when the active conversation no longer matches the
// one the session was established under (or is gone). The next cycle then
// re-hellos with the new conversation identity — or idles when there is none.
function invalidateStaleSession(): void {
  if (sessionId && cfg.exec.conversationId() !== sessionConversationId) {
    clearSession();
  }
}

// Lazy default transport: resolves the server origin/token from main modules.
// Kept behind a require so the poller module stays import-light and testable.
function defaultTransport(): PollerTransport {
  return {
    origin(): string {
      const { getServerOrigin } = require('./server-process');
      return getServerOrigin();
    },
    authHeader(): Record<string, string> {
      const { authHeader } = require('./server-auth');
      return authHeader();
    },
  };
}

function defaultExec(): ExecFns {
  return {
    inspect,
    navigateApprovedLink,
    scroll,
    wait,
    currentState,
    status: bridgeStatus,
    conversationId: getConversationId,
    stopRequestedSince: isStopRequestedSince,
    clearStopRequest,
  };
}

function initConfig(config: PollerConfig = {}): void {
  cfg = {
    idleDelayMs: config.idleDelayMs ?? 800,
    maxBackoffMs: config.maxBackoffMs ?? 8000,
    transport: config.transport ?? defaultTransport(),
    exec: config.exec ?? defaultExec(),
    fetchImpl: config.fetchImpl ?? ((globalThis.fetch as typeof fetch) ?? undefined)!,
  };
}

// Build the content-free digest WS4 persists from a transient observed result.
// Allowlisted keys ONLY — no text/title/href/full-url.
export function buildObservedDigest(
  observed: ObservedResult | undefined,
  status: BrowserActionResult['status'],
): Record<string, unknown> {
  const digest: Record<string, unknown> = { settled: status === 'ok' };
  if (!observed) return digest;
  if (observed.url) {
    digest.final_domain = registrableHost(observed.url);
  }
  if (Array.isArray(observed.links)) digest.link_count = observed.links.length;
  return digest;
}

// The server mounts every `/browse/*` compat route under the `/api/v1`
// prefix (cowork-server's api_router = APIRouter(prefix="/api/v1"); browse_router
// is included on THAT router, not on the app root) — a bare `${origin}/browse/...`
// 404s. `cfg.transport.origin()` returns the bare origin, so prefix here.
async function postJson(path: string, body: unknown): Promise<Response | null> {
  if (!cfg.transport) return null;
  try {
    return await cfg.fetchImpl(`${cfg.transport.origin()}/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cfg.transport.authHeader() },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return null;
  }
}

// Report a bridge state change to the server so it can flip `available` and
// detect tab-close / Chrome-restart. Fire-and-forget. The server's
// `_BridgeStateRequest` requires `{session_id, bridge_state}` with the
// underscore enum (`awaiting_approval`), so we map the internal hyphen state
// and skip the report entirely while the session id is unknown (before the
// first successful hello there is no session to report against — hello itself
// carries the connected state).
export async function reportBridgeState(): Promise<void> {
  if (!cfg) initConfig();
  if (!sessionId) return;
  const s = cfg.exec.status();
  const res = await postJson('/browse/bridge/state', {
    session_id: sessionId,
    bridge_state: toServerBridgeState(s.state),
  });
  // Stale session (server restart / cleanup): drop the binding so the next
  // poll cycle re-hellos with the conversation identity instead of reporting
  // into a session the server no longer knows.
  if (res && res.status === 404) clearSession();
}

// Subscribe the poller to main-process bridge-state transitions so a
// lost/detach/cross-host-nav/reconnect is reported to the server IMMEDIATELY
// (server flips `available` / detects tab-close-or-Chrome-restart) instead of
// waiting for the next long-poll cycle or a timeout. Idempotent: a second call
// replaces the prior subscription.
let unsubscribeState: (() => void) | null = null;
function subscribeBridgeState(): void {
  if (unsubscribeState) return;
  unsubscribeState = onBridgeStateChange(() => {
    // A transition means the hello identity may need re-establishing on the
    // next `connected`; report the fresh state now regardless (no-op while
    // the server session id is unknown).
    if (currentState() !== 'connected') helloSent = false;
    void reportBridgeState().finally(() => {
      // A full detach/revoke ends the session binding — the next approval
      // hellos with the (possibly new) conversation id. `lost` keeps the
      // session id so a reconnect can resume the same server session.
      if (currentState() === 'disconnected') clearSession();
    });
  });
}

// Execute one command through the correct WS1 primitive.
export async function executeCommand(cmd: BridgeCommand): Promise<BrowserActionResult> {
  switch (cmd.action_type) {
    case 'inspect':
      return cfg.exec.inspect();
    case 'navigate':
      return cfg.exec.navigateApprovedLink(cmd.href ?? '');
    case 'scroll':
      return cfg.exec.scroll(cmd.direction ?? 'down');
    case 'wait':
      return cfg.exec.wait(cmd.wait_ms ?? 1000);
    default:
      return {
        status: 'unsupported_action',
        action: 'inspect',
        reason: `Unknown action_type: ${(cmd as { action_type?: string }).action_type}`,
      };
  }
}

// Assemble the exact BridgeCommandResult body the server persists. `observed`
// is the transient blob merged with the content-free digest keys
// (final_domain/link_count/settled) the server's build_observed_digest picks;
// it is omitted on non-ok results (the server never records observed on
// failure, and an `ok` with no observed is downgraded server-side).
export function buildResultPayload(
  commandId: string,
  result: BrowserActionResult,
): BridgeCommandResult {
  const payload: BridgeCommandResult = {
    command_id: commandId,
    result_code: toInternalResultCode(result.status),
  };
  if (result.reason) payload.detail = result.reason;
  if (result.status === 'ok' && result.observed) {
    payload.observed = {
      ...result.observed,
      ...buildObservedDigest(result.observed, result.status),
    };
  }
  return payload;
}

async function pollOnce(): Promise<'command' | 'idle' | 'error'> {
  if (inFlight) return 'idle';
  inFlight = true;
  try {
    // A conversation switch (or clear) invalidates the session the poller
    // established under the previous conversation — never keep polling it.
    invalidateStaleSession();
    // Say hello once the bridge is connected. hello UPSERTs the
    // conversation-scoped BrowserSession server-side, keyed by the ACTIVE
    // conversation id the renderer handed main at approval time plus the
    // approved host-only `domain` (content-free). The server 422s an
    // anonymous hello, so without an identity (no conversation and no prior
    // session) there is nothing to poll yet. The response carries the
    // server-issued `session_id` every session-keyed endpoint requires.
    if (!helloSent && cfg.exec.currentState() === 'connected') {
      const conversationId = cfg.exec.conversationId();
      if (!conversationId && !sessionId) return 'idle';
      const s = cfg.exec.status();
      const usedConversation = Boolean(conversationId);
      const hello = await postJson('/browse/bridge/hello', {
        os: process.platform,
        ...(usedConversation
          ? { conversation_id: conversationId, domain: s.domain }
          : { session_id: sessionId }),
      });
      if (!hello || !hello.ok) {
        // A 404 on the session_id path means the server no longer knows the
        // session (restart / cleanup) — drop it so the next cycle re-hellos
        // with the conversation identity instead of erroring forever. A 404
        // on the conversation path means the id was temporary / never
        // persisted; the renderer re-syncs the canonical id on adoption, so
        // just retry next cycle.
        if (hello?.status === 404 && !usedConversation) clearSession();
        return 'error';
      }
      try {
        const body = (await hello.json()) as { session_id?: string } | null;
        if (body?.session_id) sessionId = body.session_id;
      } catch {
        /* tolerate a bodyless 200 */
      }
      // Remember which conversation this session belongs to so a later
      // conversation switch invalidates it (see invalidateStaleSession).
      sessionConversationId = conversationId ?? sessionConversationId;
      helloSent = true;
    }
    if (cfg.exec.currentState() !== 'connected') {
      helloSent = false;
      return 'idle';
    }
    // No session id means the server never acknowledged a hello — the
    // session-keyed endpoints would 422, so wait for the next cycle.
    if (!sessionId) return 'idle';

    // Snapshot when this long-poll starts: the local Stop latch below gates a
    // returned command only if Stop was pressed AFTER this instant (the
    // raced case — the command may have been handed out pre-stop).
    const pollStartedAt = Date.now();
    const res = await postJson('/browse/commands/next', { session_id: sessionId });
    if (!res || !res.ok) {
      // Stale session (server restarted / session cleaned up): drop the
      // binding and re-hello with the conversation identity next cycle.
      if (res?.status === 404) clearSession();
      return 'error';
    }
    const body = (await res.json()) as { command?: BridgeCommand | null } | null;
    const cmd = body?.command ?? null;
    if (!cmd || !cmd.command_id) {
      // An empty poll that STARTED after the stop proves the raced window is
      // closed (the server, which is stopped, handed nothing to this wire) —
      // drop the stale latch so it can never gate a later post-resume cycle.
      // The server gate alone keeps a Stop with no new turn stopped.
      if (!cfg.exec.stopRequestedSince(pollStartedAt)) cfg.exec.clearStopRequest();
      return 'idle';
    }

    // Take-over / lost gate. Take-over detaches the bridge in main (state !=
    // connected), so re-checking here catches a take-over that landed while
    // the long-poll above was outstanding. We still report a result so the
    // server isn't left waiting on a command it handed out.
    if (cfg.exec.currentState() !== 'connected') {
      helloSent = false;
      const gated = buildResultPayload(cmd.command_id, {
        status: 'bridge_disconnected',
        action: cmd.action_type,
        reason: 'The browser was stopped or handed back before this action ran.',
      });
      await postJson(`/browse/commands/${cmd.command_id}/result`, gated);
      await reportBridgeState();
      return 'idle';
    }

    // Local Stop latch — raced case ONLY. The SERVER is the stop/resume
    // authority: its control gate (POST /browse/control/stop) hands out
    // nothing while stopped and resumes on a fresh user turn. Stop leaves the
    // local bridge connected, so the one thing the server gate cannot catch
    // is a command it handed to the wire just before the stop landed — i.e. a
    // Stop pressed AFTER this poll started. Gate that command (still
    // reporting a result so the server isn't left waiting) and clear the
    // latch: its raced-case job is done, and the server hands out nothing
    // further while stopped.
    //
    // If the Stop predates this poll's start, any command the poll returned
    // was necessarily handed out by a server whose gate had already been set
    // and then resumed by a new turn — clear the stale latch and execute
    // normally. The latch must never gate post-resume commands (that was the
    // old bug: a boolean latch outlived the server-side resume and refused
    // every command until re-approval).
    //
    // Residual millisecond race, documented honestly: if the stop POST is
    // processed by the server slightly AFTER this poll started but the local
    // requestStop() fired slightly BEFORE pollStartedAt, one pre-stop command
    // could theoretically execute. The server also re-checks its gate after
    // long-poll wakeup, so this local latch is defense-in-depth only.
    if (cfg.exec.stopRequestedSince(pollStartedAt)) {
      cfg.exec.clearStopRequest();
      const gated = buildResultPayload(cmd.command_id, {
        status: 'bridge_disconnected',
        action: cmd.action_type,
        reason: 'The browser was stopped before this action ran.',
      });
      await postJson(`/browse/commands/${cmd.command_id}/result`, gated);
      return 'idle';
    }
    // Any latch set before this poll started is stale (server already
    // resumed) — drop it so it can never gate a later cycle.
    cfg.exec.clearStopRequest();

    const result = await executeCommand(cmd);
    await postJson(
      `/browse/commands/${cmd.command_id}/result`,
      buildResultPayload(cmd.command_id, result),
    );
    return 'command';
  } catch {
    return 'error';
  } finally {
    inFlight = false;
  }
}

// Start the poll loop. Idempotent — a second call is a no-op while running.
export function startBrowserCommandPoller(config: PollerConfig = {}): void {
  if (running) return;
  initConfig(config);
  running = true;
  stopped = false;
  helloSent = false;
  subscribeBridgeState();
  void loop();
}

async function loop(): Promise<void> {
  let backoff = cfg.idleDelayMs;
  while (!stopped) {
    const outcome = await pollOnce();
    if (stopped) break;
    if (outcome === 'error') {
      backoff = Math.min(backoff * 2, cfg.maxBackoffMs);
    } else {
      backoff = cfg.idleDelayMs;
    }
    await sleep(outcome === 'command' ? 0 : backoff);
  }
  running = false;
}

// Stop cleanly (quit-drain / disposeAllBridges). Resumes on the next start.
export function stopBrowserCommandPoller(): void {
  stopped = true;
  running = false;
  clearSession();
  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }
}

// Test-only: force a single poll cycle with the given config.
export async function __pollOnceForTest(config: PollerConfig): Promise<'command' | 'idle' | 'error'> {
  initConfig(config);
  return pollOnce();
}

export function __resetPollerForTest(): void {
  running = false;
  stopped = true;
  inFlight = false;
  clearSession();
  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
