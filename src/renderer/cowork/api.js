// Resolve the API origin through host: Electron uses its assigned loopback port; web and dev use
// the page origin.

import { initialStreamState, reduceStream, iterateSSE } from './lib/responseStreamAdapter';
import { isAntonConfigError } from './lib/antonErrors';
import { host } from '../platform/host';
import { relativeAge } from './lib/formatTime';
import { transformSettingsRows, diffSettingsForWrite, mergeRecommendedModels, CLIENT_TO_SERVER } from './lib/settingsTransform';
import { MODEL_ROUTER_ID } from './lib/modelCatalog';
import { cacheSettings } from './lib/settingsCache';
import { setAntonInstallId } from './lib/analytics';
import { artifactIdentity } from './lib/artifactIdentity';
import { getOrgMode } from '../lib/orgMode';
import {
  expectedOrganizationHeaders,
  handleOrganizationBoundaryResponse,
} from './lib/organizationRequestBoundary';
import {
  buildMemoryDeletePayload,
  buildMemoryWritePayload,
  groupMemoryItems,
  resolveProjectId,
} from './lib/memoryTransform';

const API_ORIGIN = host.getApiOrigin();

export const BASE = `${API_ORIGIN}/api/v1`;
const ROOT_BASE = `${API_ORIGIN}`;

// Web sends the refreshed Keycloak token in Authorization. Electron injects its separate loopback
// token
// from the main process; that token never reaches the renderer.
export async function authFetch(url, options = {}) {
  if (host.isWeb) {
    const token = await host.getAccessToken();
    if (token) {
      options = {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
          ...expectedOrganizationHeaders(token),
        },
      };
    }
  }
  const response = await fetch(url, options);
  if (host.isWeb && handleOrganizationBoundaryResponse(response)) {
    throw new Error('The active organization changed; reload required');
  }
  return response;
}

async function req(path, options = {}) {
  const res = await authFetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      const raw = data?.detail;
      detail = Array.isArray(raw)
        ? raw.map((e) => e.msg || JSON.stringify(e)).join(', ')
        : (raw || data?.message || '');
    } catch {
      detail = await res.text().catch(() => '');
    }
    const err = new Error(detail || `API ${path} returned ${res.status}`);
    err.status = res.status;  // let callers branch on the HTTP code (e.g. 404 fallbacks)
    throw err;
  }
  if (res.status === 204) return { ok: true };
  return res.json();
}

async function rootReq(path, options = {}) {
  const res = await authFetch(ROOT_BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  if (res.status === 204) return { ok: true };
  return res.json();
}

// Share concurrent requests by key; callers must include all path/query parameters.
// Entries expire on settlement. forceFresh replaces the pending request for subsequent callers.
const _inflight = new Map();
function dedupe(key, factory, { forceFresh = false } = {}) {
  const existing = _inflight.get(key);
  if (existing && !forceFresh) return existing.promise;

  // An older request must not delete the replacement started by a post-mutation read.
  const generation = Symbol(key);
  const promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      if (_inflight.get(key)?.generation === generation) {
        _inflight.delete(key);
      }
    });
  _inflight.set(key, { generation, promise });
  return promise;
}

async function responseError(res, fallback) {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.detail || data?.message || '';
  } catch {
    detail = await res.text().catch(() => '');
  }
  return new Error(detail || fallback);
}

// Capture the install ID here so every health caller supplies the analytics join key.
// setAntonInstallId gates to desktop.
export async function fetchHealth() {
  try {
    const health = await rootReq('/api/v1/health');
    // Analytics failures must not make this boot-readiness check report the server offline.
    try {
      setAntonInstallId(health?.aid);
    } catch {
      /* ignore — the join key is worth less than a correct readiness answer */
    }
    return health;
  } catch {
    // Keep the stable install ID through outages so health blips do not remove the analytics join
    // key.
    return { status: 'offline', anton_available: false };
  }
}

// Tasks combine Anton conversation metadata with Cowork UI state, including pins and attachments.

function _failedEventMeta(events) {
  if (!Array.isArray(events)) return null;
  const ev = [...events].reverse().find((e) => e?.type === 'response.failed');
  if (!ev) return null;
  return {
    code: ev.code || null,
    message: ev.error || ev.message || '',
    // Keep failure-card context consistent with App.jsx failedEventMeta so reload offers the same
    // recovery action.
    reconnectable: ev.reconnectable ?? null,
    providerLabel: ev.provider_label ?? null,
    failedModel: ev.model ?? null,
    // ENG-1537 — see App.jsx's failedEventMeta; the two paths must agree.
    retryAfter: typeof ev.retry_after === 'number' ? ev.retry_after : null,
    // Keep the grant-reset ISO string intact for formatting in the viewer’s timezone.
    resetAt: typeof ev.reset_at === 'string' ? ev.reset_at : null,
    // Use retry_at: message created_at lacks a timezone and would shift the retry deadline in
    // non-UTC locales.
    retryAt: typeof ev.retry_at === 'string' ? ev.retry_at : null,
    // The remote turn's own correlation id (cowork-server) — the one thing a
    // generic anton_error bubble can still offer for a support lookup.
    requestId: typeof ev.request_id === 'string' ? ev.request_id : null,
  };
}

// Replay persisted SSE events through the live reducer so reload restores the same steps and
// startedAt.
function _hydrateAssistantEvents(messages) {
  if (!Array.isArray(messages)) return messages || [];
  const out = [];
  for (const m of messages) {
    if (m?.role !== 'assistant' || !Array.isArray(m.events) || m.events.length === 0) {
      out.push(m);
      continue;
    }
    let state = initialStreamState();
    for (const ev of m.events) {
      try { state = reduceStream(state, ev, Date.now, { replay: true }); } catch {}
    }
    const { events: _drop, ...rest } = m;
    const turnComplete = state.status === 'done' || state.status === 'error';
    const completeFlag = turnComplete ? { _turnComplete: true } : {};
    out.push({
      ...rest,
      ...(state.steps?.length > 0
        ? { steps: state.steps, startedAt: rest.startedAt || state.startedAt || null }
        : {}),
      ...completeFlag,
    });
    if (state.status === 'error') {
      const failed = _failedEventMeta(m.events);
      // Match the live-stream mapping in App.jsx so reopened config/auth failures retain the
      // provider card.
      if (isAntonConfigError(failed?.message, { code: failed?.code })) {
        out.push({ role: 'provider_required' });
      } else {
        out.push({
          role: 'error',
          content: failed?.message || 'An unexpected error occurred.',
          code: failed?.code || null,
          reconnectable: failed?.reconnectable ?? null,
          providerLabel: failed?.providerLabel ?? null,
          retryAfter: failed?.retryAfter ?? null,
          resetAt: failed?.resetAt ?? null,
          retryAt: failed?.retryAt ?? null,
          failedModel: failed?.failedModel ?? null,
          requestId: failed?.requestId ?? null,
        });
      }
    }
  }
  return out;
}

function _conversationToTask(conv, messages = []) {
  // projectName is the server identity; App.jsx resolves projectPath from the projects list.
  // Hydrate persisted events here so reload and live streams expose the same message shape.
  const rawDisabled = conv.disabled_connections ?? conv.disabledConnections;
  const disabledConnections = Array.isArray(rawDisabled)
    ? rawDisabled
      .filter((x) => x && typeof x.engine === 'string' && typeof x.name === 'string')
      .map((x) => ({ engine: x.engine.trim(), name: x.name.trim() }))
    : [];

  return {
    id: conv.id,
    title: conv.title || conv.preview || conv.id || 'Untitled task',
    subtitle: relativeAge(conv.updated_at || conv.created_at) || '',
    status: 'idle',
    messages: _hydrateAssistantEvents(messages),
    projectName: conv.project || null,
    projectId: conv.project_id || null,
    projectPath: conv.project_path || null,
    harness: conv.harness || null,
    model: conv.model || null,
    attachments: [],
    disabledConnections,
    pinned: false,
    // Group scheduled executions by schedule; chat-created conversations have no schedule linkage.
    scheduledId: conv.scheduled_id || conv.scheduledId || null,
    updatedAt: conv.updated_at || conv.updatedAt || null,
    createdAt: conv.created_at || conv.createdAt || null,
  };
}

/** The raw list request. Throws on failure so callers that need to tell an
 * empty account from a broken fetch can (ENG-2246) — `fetchConversationList`
 * below keeps the swallowing contract its other caller relies on. */
async function requestConversationList() {
  // The server otherwise defaults to the active project, hiding tasks from other projects on
  // refresh.
  const list = await req('/conversations/?project=all&limit=200');
  return Array.isArray(list?.conversations) ? list.conversations : [];
}

export async function fetchConversationList() {
  try {
    return await requestConversationList();
  } catch {
    return [];
  }
}

/** Create a task record directly (bypassing the `/responses` stream) — used
 * by coding-mode (MVP): the actual work happens in an external CLI, but the
 * task should still show up with its harness/model recorded. */
export async function createConversation({ project, projectId, topic, harness, model } = {}) {
  return req('/conversations/', {
    method: 'POST',
    body: JSON.stringify({ project, projectId, topic, harness, model }),
  });
}

const EAGER = 50;

/**
 * Resolve after the list arrives; optionally warm transcripts in the background through onItems.
 * Returns Task[] or { error: true, status }; callers must check the shape, not truthiness.
 */
export async function fetchSessions({ onItems } = {}) {
  let conversations;
  try {
    conversations = await requestConversationList();
  } catch (err) {
    return { error: true, status: (err && err.status) || 0 };
  }
  if (conversations.length === 0) return [];

  // Warm only when onItems can consume the transcripts. Individual failures must not block the
  // list.
  if (onItems) {
    for (const c of conversations.slice(0, EAGER)) {
      req(`/conversations/${encodeURIComponent(c.id)}/items`)
        // Hydration restores steps, startedAt, and synthetic failure cards; raw messages omit them.
        .then((r) => onItems(c.id, _hydrateAssistantEvents(Array.isArray(r) ? r : [])))
        .catch(() => {});
    }
  }

  // Skip malformed rows so a bad conversation cannot leave callers stuck loading.
  return conversations
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      try {
        return _conversationToTask(c, []);
      } catch (err) {
        // Dropping it beats stranding the whole list, but a conversation that
        // silently vanishes from the sidebar is un-diagnosable without this.
        // eslint-disable-next-line no-console
        console.warn('[fetchSessions] skipped a malformed conversation row', c?.id, err);
        return null;
      }
    })
    .filter(Boolean);
}

export async function fetchSession(id) {
  try {
    const [meta, msgs] = await Promise.all([
      req(`/conversations/${encodeURIComponent(id)}`).catch(() => null),
      req(`/conversations/${encodeURIComponent(id)}/items`).catch(() => null),
    ]);
    if (!meta) return null;
    return _conversationToTask(meta, Array.isArray(msgs) ? msgs : []);
  } catch {
    return null;
  }
}

/**
 * Loader-facing conversation fetch. Unlike `fetchSession` (which collapses every
 * failure to `null`), this separates a gone conversation (`404 → 'not_found'`)
 * from an operational failure (auth / 5xx / network `→ 'unavailable'`) so the
 * route can drop a dead link Home but keep the URL + retry on a transient
 * outage. Metadata is authoritative for existence. A failed transcript is only
 * treated as an empty conversation on a 404 (the one benign case); any other
 * items failure is 'unavailable' so a real transcript is never silently blanked.
 *
 * @returns {Promise<{status:'ok', task:object} | {status:'not_found'} | {status:'unavailable', code:number}>}
 */
export async function fetchSessionResult(id) {
  const [metaRes, msgsRes] = await Promise.allSettled([
    req(`/conversations/${encodeURIComponent(id)}`),
    req(`/conversations/${encodeURIComponent(id)}/items`),
  ]);
  if (metaRes.status === 'rejected') {
    const err = metaRes.reason;
    if (err && err.status === 404) return { status: 'not_found' };
    // `err.status` is undefined for a network/abort failure — code 0.
    return { status: 'unavailable', code: (err && err.status) || 0 };
  }
  // The conversation exists but its transcript failed to load. Only a 404 is
  // benign (existing conversation, nothing recorded yet → render empty); auth /
  // 5xx / network would blank a real transcript, so surface the retry instead.
  if (msgsRes.status === 'rejected') {
    const err = msgsRes.reason;
    if (!(err && err.status === 404)) {
      return { status: 'unavailable', code: (err && err.status) || 0 };
    }
  }
  const msgs = msgsRes.status === 'fulfilled' && Array.isArray(msgsRes.value) ? msgsRes.value : [];
  return { status: 'ok', task: _conversationToTask(metaRes.value, msgs) };
}

/**
 * Allocate a UUID the server can adopt so attachments uploaded before the first turn stay on the
 * conversation.
 */
export function allocateConversationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // randomUUID is gated to secure contexts, but getRandomValues isn't —
  // assemble an RFC-4122 v4 UUID from raw bytes so the server can still
  // adopt the id (and CodeQL doesn't flag a Math.random in the id flow).
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // No crypto at all (not a real Electron/browser case): the server
  // can't adopt a non-UUID id but re-links the uploads it covers.
  return `${Date.now().toString(36)}-${(typeof performance !== 'undefined' ? Math.floor(performance.now() * 1e6) : 0).toString(36)}`;
}

// Omit conversationId to start a conversation. The first onChunk/onProgress/onDone callback returns
// its ID as the second argument.
function _streamResponse(text, { conversationId, projectName, projectId, projectPath, model, harness, reasoningEffort, attachmentIds = [], disabledConnections, onChunk, onProgress, onToolResult, onDone, onError, onEvent } = {}) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await authFetch(`${BASE}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          // MODEL_ROUTER_ID is renderer-only; null lets the server resolve the account’s configured
          // model.
          model: (model && model !== MODEL_ROUTER_ID) ? model : null,
          // Omit an unset per-task harness so the server retains the account default.
          ...(harness ? { harness } : {}),
          // Per-turn effort overrides the account setting. Omit it when unset for older servers and
          // models without effort support.
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          stream: true,
          conversation: conversationId || null,
          // Server's `project` field is a project NAME (folder under
          // projects_store). Sending project_path is silently ignored —
          // every conversation would fall back to the active project.
          project: projectName || null,
          // Names are mutable (rename) — the id is the stable identifier,
          // so send it whenever the caller has one (ENG-1028). Conditional
          // so older servers never see an unknown field.
          ...(projectId ? { project_id: projectId } : {}),
          attachment_ids: attachmentIds,
          ...(disabledConnections !== undefined
            ? { disabled_connections: disabledConnections }
            : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw await responseError(res, `Response stream failed (${res.status})`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let cid = conversationId || null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const block of events) {
          // Each SSE event is `event: ...\ndata: ...`. Pull out the `data:` line.
          const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const raw = dataLine.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let msg;
          try { msg = JSON.parse(raw); } catch { continue; }

          // Raw passthrough — used by the streamAdapter to build a
          // structured ThinkingStep[] for the UI. Fires before the
          // type-specific routing so existing callbacks still work.
          onEvent?.(msg);

          switch (msg.type) {
            case 'response.created':
              cid = msg.conversation_id || msg.response?.id || cid;
              break;
            case 'response.output_text.delta':
              onChunk?.(msg.delta || '', cid);
              break;
            case 'response.in_progress': {
              const role = msg.thought_role || '';
              if (role === 'thought.scratchpad.result') {
                onToolResult?.({
                  type: 'tool_result',
                  name: msg.tool_name || '',
                  action: msg.tool_action || '',
                  content: msg.content || '',
                }, cid);
              } else {
                onProgress?.({
                  type: 'progress',
                  phase: msg.phase || role.replace(/^thought\./, '') || 'progress',
                  message: msg.message || msg.content || '',
                  etaSeconds: msg.eta_seconds ?? null,
                  thoughtRole: role,
                }, cid);
              }
              break;
            }
            case 'response.completed':
              onDone?.(cid);
              return;
            case 'response.failed':
              onError?.(msg.error || msg.message || 'The agent failed', { ...msg, code: msg.code });
              return;
            default:
              break;
          }
        }
      }
      onDone?.(cid);
    } catch (err) {
      // Distinct code from tailInFlight's reconnect_error: this is a dropped
      // connection on the initial send, not a reconnect attempt.
      if (err.name !== 'AbortError') onError?.(err.message, { code: 'stream_error' });
    }
  })();
  return ctrl;
}

export function streamNewSession(text, opts = {}) {
  return _streamResponse(text, opts);
}

// Probe before opening a tail on an existing turn. tailInFlight uses the same callbacks as
// _streamResponse.
export async function fetchInFlightStatus(conversationId) {
  if (!conversationId) return { in_flight: false, has_buffer: false, latest_seq: 0 };
  try {
    return await req(`/responses/in-flight?conversation_id=${encodeURIComponent(conversationId)}`);
  } catch {
    return { in_flight: false, has_buffer: false, latest_seq: 0 };
  }
}

// Return running conversation IDs for cross-client reconciliation.
// A failed poll returns null, not []; treating failure as an empty list could abort healthy turns.
export async function fetchInFlightList() {
  try {
    const res = await req('/responses/in-flight-list');
    return Array.isArray(res?.in_flight) ? res.in_flight : [];
  } catch {
    return null;
  }
}

// Match the server’s 300s producer-idle timeout. Count event frames, not bytes: keepalive comments
// continue during a stalled turn and must not prevent the shared stream slot from being released.
const TAIL_IDLE_TIMEOUT_MS = 300_000;

export function tailInFlight(conversationId, {
  fromSeq = 0,
  model = 'anton',
  idleTimeoutMs = TAIL_IDLE_TIMEOUT_MS,
  onChunk, onProgress, onToolResult, onDone, onError, onEvent,
} = {}) {
  const ctrl = new AbortController();
  // Bumped per real producer frame; cleared in the finally so a cleanly
  // finished tail leaves no dangling timer.
  let idleTimer = null;
  let idledOut = false;
  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idledOut = true; ctrl.abort(); }, idleTimeoutMs);
  };
  (async () => {
    try {
      bumpIdle();
      const url = `${BASE}/responses/tail?conversation_id=${encodeURIComponent(conversationId)}&from_seq=${fromSeq}&model=${encodeURIComponent(model)}`;
      const res = await authFetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      if (res.status === 404) {
        // Buffer's gone — nothing to tail. Treat as a clean no-op so
        // the caller can fall back to history.
        onDone?.(conversationId);
        return;
      }
      if (!res.ok) throw await responseError(res, `Tail stream failed (${res.status})`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let cid = conversationId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const block of events) {
          const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const raw = dataLine.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let msg;
          try { msg = JSON.parse(raw); } catch { continue; }
          // Real producer frame — reset the idle window. (Keepalives have no
          // `data:` line and never reach here, so a silent producer still trips.)
          bumpIdle();
          onEvent?.(msg);
          switch (msg.type) {
            case 'response.created':
              cid = msg.conversation_id || cid;
              break;
            case 'response.output_text.delta':
              onChunk?.(msg.delta || '', cid);
              break;
            case 'response.in_progress': {
              const role = msg.thought_role || '';
              if (role === 'thought.scratchpad.result') {
                onToolResult?.({
                  type: 'tool_result',
                  name: msg.tool_name || '',
                  action: msg.tool_action || '',
                  content: msg.content || '',
                }, cid);
              } else {
                onProgress?.({
                  type: 'progress',
                  phase: msg.phase || role.replace(/^thought\./, '') || 'progress',
                  message: msg.message || msg.content || '',
                  etaSeconds: msg.eta_seconds ?? null,
                  thoughtRole: role,
                }, cid);
              }
              break;
            }
            case 'response.completed':
              onDone?.(cid);
              return;
            case 'response.failed':
              onError?.(msg.error || msg.message || 'The agent failed', { ...msg, code: msg.code });
              return;
            default:
              break;
          }
        }
      }
      onDone?.(cid);
    } catch (err) {
      // An idle-timeout abort surfaces as an AbortError too, but unlike a
      // caller-initiated abort (a new send or navigation) it must release the
      // slot — so report it as an error the reconnect's onError acts on.
      if (idledOut) {
        // Aborting the consumer leaves the producer running; cancel it too so polling cannot
        // repeatedly reopen the stalled turn.
        cancelResponse(conversationId);
        onError?.('The response stalled and was ended. Please try sending again.', { code: 'stalled' });
      } else if (err.name !== 'AbortError') {
        onError?.(err.message, { code: 'reconnect_error' });
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  })();
  return ctrl;
}

export function streamMessage(sessionId, text, opts = {}) {
  // Strip temporary renderer IDs; response.created supplies the canonical ID that App.jsx adopts in
  // place.
  const conversationId = sessionId && !String(sessionId).startsWith('tmp-')
    ? sessionId
    : null;
  return _streamResponse(text, { ...opts, conversationId });
}

// ─── Projects ─────────────────────────────────────────────────────────────────
// Server returns a flat array of project objects (with id, name, path,
// is_active). Older servers wrapped in { projects: [...] } — handle both.
export async function fetchProjects() {
  try {
    const data = await req('/projects/');
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

export async function createProject(name) {
  return req('/projects/', { method: 'POST', body: JSON.stringify({ name }) });
}

// Accept a project object or legacy name string. The server renames its directory/references and
// returns the updated record.
export async function renameProject(projectOrName, newName) {
  const id = projectOrName?.id;
  if (id) {
    return req(`/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName }),
    });
  }
  const projects = await fetchProjects();
  const match = projects.find((p) => p.name === projectOrName);
  if (!match?.id) throw new Error(`Project "${projectOrName}" not found`);
  return req(`/projects/${encodeURIComponent(match.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: newName }),
  });
}

export async function revealProjectInFinder(projectPath) {
  if (!projectPath) return null;
  try {
    return await req('/artifacts/reveal', {
      method: 'POST',
      body: JSON.stringify({ path: projectPath }),
    });
  } catch {
    return null;
  }
}

export async function cancelScratchpad(name) {
  if (!name) return null;
  try {
    return await req('/scratchpad/cancel', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  } catch {
    // 404 = pad already gone, treat as success.
    return { status: 'gone', name };
  }
}

// Aborting SSE stops only the consumer; use this to stop the producer. Never throws.
// Returns ok when acknowledged, gone on 404, or error when cancellation is unconfirmed; callers
// must not report error as success.
export async function cancelResponse(conversationId) {
  if (!conversationId) return { status: 'gone', conversation_id: conversationId };
  try {
    const res = await req('/responses/cancel', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId }),
    });
    return { status: 'ok', ...res };
  } catch (err) {
    // Only 404 confirms there is nothing to stop; other failures leave cancellation unconfirmed.
    if (err?.status === 404) return { status: 'gone', conversation_id: conversationId };
    return { status: 'error', conversation_id: conversationId };
  }
}

/**
 * Deliver an answer to a blocked turn. Callers must distinguish not_found, already_answered,
 * rejected, and error outcomes.
 */
export async function submitAnswer(conversationId, questionId, answer) {
  if (!conversationId || !questionId) return { status: 'not_found' };
  try {
    return await req('/responses/answer', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        question_id: questionId,
        ...answer,
      }),
    });
  } catch (err) {
    const status = err?.status;
    if (status === 404) return { status: 'not_found' };
    if (status === 409) return { status: 'already_answered' };
    if (status === 400) return { status: 'rejected' };
    return { status: 'error' };
  }
}

export async function unpublishArtifact(path) {
  // Idempotent — server 404 means "no record" which is the desired
  // end state.
  const res = await authFetch(BASE + `/publish?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return { status: 'gone' };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Unpublish failed (${res.status})`);
  }
  return res.json();
}

// Org deletion uses the artifact identity/slug within its project; desktop uses a path and accepts
// legacy path strings.
export async function deleteArtifact(artifact) {
  // Older replayed cards have short IDs the endpoint cannot resolve; fall back to their slug.
  const artifactRef = artifactIdentity(artifact) || artifact?.slug;
  const url = artifact?.projectId && artifactRef
    ? `/artifacts/${encodeURIComponent(artifactRef)}`
      + `?project_id=${encodeURIComponent(artifact.projectId)}`
    : `/artifacts/?path=${encodeURIComponent(
        typeof artifact === 'string' ? artifact : (artifact?.folder || artifact?.path || ''),
      )}`;
  const res = await authFetch(BASE + url, { method: 'DELETE' });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete failed (${res.status})`);
  }
  return { status: 'deleted' };
}

// Delete a project by object (with id) or name string.
export async function deleteProject(projectOrName) {
  let id = projectOrName?.id;
  const name = typeof projectOrName === 'string' ? projectOrName : projectOrName?.name;
  if (!id) {
    const projects = await fetchProjects();
    const match = projects.find((p) => p.name === name);
    if (!match?.id) return { status: 'gone', name };
    id = match.id;
  }
  // Idempotent: 404 = "already gone" = success.
  const res = await authFetch(BASE + `/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return { status: 'gone', name };
  if (res.status === 204) return { status: 'deleted', name };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete failed (${res.status})`);
  }
  return res.json();
}

// Project file paths are relative to the project root; instructions live at
// ANTON_PROJECT_INSTRUCTIONS_PATH.

const enc = encodeURIComponent;

/** Relative path from project root for project instructions (projects file API). */
export const ANTON_PROJECT_INSTRUCTIONS_PATH = '.anton/anton.md';

export function isProjectInstructionsPath(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === ANTON_PROJECT_INSTRUCTIONS_PATH;
}

/** Legacy installs: true if `relPath` is under `.context/` (pre-migration tree). */
export function isUnderContextDir(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === '.context' || r.startsWith('.context/');
}

export function isUnderAntonDir(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === '.anton' || r.startsWith('.anton/');
}

/**
 * Stat the instructions file without listing the project. Returns { file: { path, name, size,
 * modified, is_dir, synthetic? } }.
 * synthetic means the file does not exist yet and can be authored. Concurrent reads are coalesced.
 */
export async function fetchProjectInstructions(projectName) {
  if (!projectName) return { file: null };
  return dedupe(`projects/${projectName}/instructions`, () =>
    req(`/projects/${enc(projectName)}/instructions`),
  );
}

export async function listProjectFiles(projectName, { forceFresh = false } = {}) {
  if (!projectName) return { files: [] };
  // Coalesce concurrent readers, but expire on settlement so later polls fetch fresh data.
  const request = () => req(`/projects/${enc(projectName)}/files`);
  // After a successful mutation, forceFresh must start a new GET rather than join a pre-mutation
  // read.
  return dedupe(`projects/${projectName}/files`, request, { forceFresh });
}

export async function readProjectFile(projectName, path) {
  // `path` may have slashes — encode each segment, not the whole
  // string (encodeURIComponent('a/b') → 'a%2Fb' which the FastAPI
  // route would treat as a single literal segment).
  const safe = path.split('/').map(enc).join('/');
  return req(`/projects/${enc(projectName)}/files/${safe}`);
}

// Mount the file’s parent directory and return the iframe URL, matching artifact previews.
export async function mountProjectFilePreview(projectName, path) {
  return req(`/projects/preview-mount-file`, {
    method: 'POST',
    body: JSON.stringify({ name: projectName, path }),
  });
}

// The raw-file response uses Content-Disposition: attachment to download instead of render inline.
export function projectFileDownloadUrl(projectName, path) {
  const safe = path.split('/').map(enc).join('/');
  return `${BASE}/projects/${enc(projectName)}/files-raw/${safe}`;
}

export async function writeProjectFile(projectName, path, content) {
  const safe = path.split('/').map(enc).join('/');
  const res = await authFetch(BASE + `/projects/${enc(projectName)}/files/${safe}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content || '' }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Write failed (${res.status})`);
  }
  return res.json();
}

export async function uploadProjectFiles(projectName, files) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  const res = await authFetch(BASE + `/projects/${enc(projectName)}/files/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function deleteProjectFile(projectName, path) {
  const safe = path.split('/').map(enc).join('/');
  const res = await authFetch(BASE + `/projects/${enc(projectName)}/files/${safe}`, {
    method: 'DELETE',
  });
  if (res.status === 404) return { status: 'gone', path };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete failed (${res.status})`);
  }
  return res.json();
}


export async function fetchActiveProject() {
  try {
    const projects = await fetchProjects();
    const active = projects.find((p) => p.is_active || p.isActive);
    return active?.name || null;
  } catch {
    return null;
  }
}

// Set the active project via PATCH /projects/{id} with { is_active: true }.
// Accepts a project object (with id) or a name string.
export async function setActiveProject(projectOrName) {
  const id = projectOrName?.id;
  if (id) {
    return req(`/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: true }),
    });
  }
  const name = typeof projectOrName === 'string' ? projectOrName : projectOrName?.name;
  const projects = await fetchProjects();
  const match = projects.find((p) => p.name === name);
  if (!match?.id) throw new Error(`Project "${name}" not found`);
  return req(`/projects/${encodeURIComponent(match.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: true }),
  });
}

// Coalesce concurrent artifact reads; project-row callers can otherwise repeat the system-wide
// request.
export async function fetchArtifacts({ projectId, projectPath } = {}) {
  // Scope with projectId in org mode or projectPath on desktop; omit both for the global list.
  // Org deployments reject filesystem paths because they carry no tenant identity.
  let suffix = '';
  if (projectId) suffix = `?project_id=${encodeURIComponent(projectId)}`;
  else if (projectPath) suffix = `?project_path=${encodeURIComponent(projectPath)}`;
  // Dedupe key includes the suffix so a global fetch and a scoped fetch don't
  // share an in-flight promise.
  return dedupe(`artifacts${suffix}`, async () => {
    try {
      return await req(`/artifacts/${suffix}`);
    } catch {
      return [];
    }
  });
}

// Propagate failures so the liveness store cannot mistake an outage for every artifact being
// deleted.
// The store coalesces its own loads.
export async function fetchArtifactsStrict({ projectId, projectPath } = {}) {
  let suffix = '';
  if (projectId) suffix = `?project_id=${encodeURIComponent(projectId)}`;
  else if (projectPath) suffix = `?project_path=${encodeURIComponent(projectPath)}`;
  const data = await req(`/artifacts/${suffix}`);
  return Array.isArray(data) ? data : [];
}

export async function previewArtifact(path) {
  return req(`/artifacts/preview?path=${encodeURIComponent(path)}`);
}

// Poll current publish/access status without reopening the viewer. Return null on failure,
// including older servers without this route.
export async function fetchArtifactStatus(path) {
  if (!path) return null;
  // This route is desktop-only; org deployments reject it with 403.
  if (getOrgMode()) return null;
  try {
    return await req(`/artifacts/status?path=${encodeURIComponent(path)}`);
  } catch {
    return null;
  }
}

// Static previews return an iframe URL; proxy previews return a directory for the local preview
// proxy.
// Use kind as the discriminator; url remains for legacy callers.
export async function mountArtifactPreview(path) {
  const data = await req('/artifacts/preview-mount', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
  const kind = data?.kind || (data?.relUrl ? 'static' : '');
  // Prefer the stateless `serveUrl` over the token `relUrl`: it's stable,
  // shareable, and resolves against any origin — works in web deployment.
  // `serveUrl` already carries `/v1`, so combine with ROOT_BASE, not BASE.
  const url = data?.serveUrl
    ? `${ROOT_BASE}${data.serveUrl}`
    : (data?.relUrl ? `${BASE}${data.relUrl}` : '');
  return {
    kind,
    token: data?.token,
    entry: data?.entry,
    artifactDir: data?.artifactDir || '',
    // Backend port for proxy previews — so the viewer can build a direct
    // `http://127.0.0.1:<port>` URL for "Open in OS" without the proxy.
    port: typeof data?.port === 'number' ? data.port : null,
    // Absolute URL the iframe loads directly (static) or empty (proxy).
    url,
    // Loopback URL of the cowork-process preview proxy. Web shell only.
    proxyUrl: data?.proxyUrl || '',
    // Origin-relative serve URL for callers that open the artifact in a
    // new tab (web "open" action).
    serveUrl: data?.serveUrl ? `${ROOT_BASE}${data.serveUrl}` : '',
    // Include the published URL on preview responses so chat cards lacking it still show
    // publication status.
    publishedUrl: data?.publishedUrl || '',
    // Backend launch status for proxy previews. When false, launchError
    // carries the reason — the viewer surfaces it instead of an empty iframe.
    backendRunning: data?.backendRunning !== false,
    launchError: data?.launchError || '',
  };
}

export async function openArtifact(path) {
  return req('/artifacts/open', { method: 'POST', body: JSON.stringify({ path }) });
}

// Convert a document artifact (markdown/HTML) to pdf|docx|html. The server
// writes the result into the same artifact folder and returns its path.
export async function exportArtifact(path, format) {
  return req('/artifacts/export', { method: 'POST', body: JSON.stringify({ path, format }) });
}

// Return the primary file’s absolute serve URL, protected by the auth proxy in production.
// Return an empty string when no primary file is available.
export function artifactServeUrl(artifact) {
  const rel = artifact?.serveUrl || '';
  if (!rel) return '';
  return rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`;
}

// Only local Electron can open an OS path; remote and web hosts use the serve URL, then the
// published URL.
export async function openArtifactFile(artifact) {
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  if (!canOpenLocalFile) {
    const url = artifactServeUrl(artifact) || artifact?.publishedUrl || '';
    if (!url) return { ok: false, reason: 'no-serve-url' };
    try { await host.openExternal(url); }
    catch { window.open(url, '_blank', 'noreferrer'); }
    return { ok: true };
  }
  return openArtifact(artifact?.path || '');
}

export async function revealArtifact(path) {
  return req('/artifacts/reveal', { method: 'POST', body: JSON.stringify({ path }) });
}

// settingsTransform.js owns pure settings translation; these wrappers perform transport.

// Snapshot of the last-fetched settings — used by diffSettingsForWrite to
// skip no-op writes and by the masked-sentinel ("***") skip logic.
let _lastFetchedSettings = {};

// Serialize settings reads/writes so a concurrent fetchSettings +
// updateSettings can't race on _lastFetchedSettings.
let _settingsLock = Promise.resolve();

/*
 * Live model IDs and effort capabilities come from MindsHub for minds-cloud and a static catalog
 * for direct providers.
 * Return null on failure so callers retain their fallback lists.
 */
export async function fetchRecommendedModels({ refresh = false } = {}) {
  try {
    // Refresh bypasses successful model-cache entries so wallet top-ups appear immediately.
    // Cached failures remain honored to avoid repeated timeouts while MindsHub is down.
    const data = await req(`/settings/recommended-models${refresh ? '?refresh=true' : ''}`);
    if (data && typeof data === 'object') return data;
  } catch { /* fall back to static lists */ }
  return null;
}

// MindsHub workspaces own hub resources and entitlements; they are separate from local working
// folders.
// Proxy through the sidecar because auth ingress does not allow Cowork origins. Use a separate
// credential
// header because Electron overwrites Authorization with its loopback token.

const HUB_CREDENTIAL_HEADER = 'X-MindsHub-Authorization';

async function hubHeaders() {
  const token = await host.getAccessToken().catch(() => null);
  return token ? { [HUB_CREDENTIAL_HEADER]: `Bearer ${token}` } : {};
}

/**
 * Return disabled only for a missing route (404) or non-object response.
 * Propagate transient failures so the caller can retry instead of permanently hiding the workspace
 * selector.
 */
export async function fetchHubWorkspaces() {
  try {
    const data = await req('/hub/workspaces/', { headers: await hubHeaders() });
    if (data && typeof data === 'object') return data;
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  return { enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null };
}

/**
 * Reject with err.status: 403 means no grant, 409 an archived workspace, and 503 an unreachable
 * hub.
 */
export async function setActiveHubWorkspace(workspaceId) {
  return req('/hub/workspaces/active', {
    method: 'PUT',
    headers: await hubHeaders(),
    body: JSON.stringify({ workspaceId }),
  });
}

export async function fetchSettings() {
  const op = _settingsLock.then(async () => {
    try {
      const rows = await req('/settings/');
      const result = transformSettingsRows(rows);
      try {
        const v = await req('/settings/validate', { method: 'POST', body: JSON.stringify({}) });
        result.configReady = v.configReady;
        result.configError = v.configError;
        result.providerLabel = v.provider;
      } catch { /* leave defaults */ }
      /*
       * Overlay live model IDs, effort support, availability, and labels. mergeRecommendedModels
       * preserves prior data on empty responses.
       */
      const merged = mergeRecommendedModels(result, await fetchRecommendedModels());
      if (merged) Object.assign(result, merged);
      _lastFetchedSettings = result;
      // Cache only fetched server settings so the next boot uses their resolved defaults.
      cacheSettings(result);
      return result;
    } catch {
      return { ...MOCK_DATA.settings, configReady: false, configError: 'Backend is offline.' };
    }
  });
  _settingsLock = op.catch(() => {});
  return op;
}

/*
 * On desktop, store the MindsHub key through main and remove both plaintext copies: minds_api_key
 * and
 * providers_json (an unencrypted column). Mask the latter with the existing *** sentinel for round
 * trips.
 * If main reports unsupported, web keeps the settings write.
 */
async function divertMindsKey(writes) {
  if (!('minds_api_key' in writes)) return writes;
  const key = writes.minds_api_key;
  const stored = await host.mindshubSetUserKey(key);
  if (!stored.supported) return writes;
  if (!stored.ok) {
    const err = new Error(`Failed to save settings: ${stored.reason || 'could not store the MindsHub key'}`);
    err.failed = ['mindsApiKey'];
    throw err;
  }
  const { minds_api_key: _diverted, ...rest } = writes;
  if (typeof rest.providers_json === 'string') {
    try {
      const cards = JSON.parse(rest.providers_json);
      if (Array.isArray(cards)) {
        for (const card of cards) {
          if (card && card.type === 'minds-cloud' && card.apiKey) card.apiKey = '***';
        }
        rest.providers_json = JSON.stringify(cards);
      }
    } catch { /* unparseable: leave it, the server masks on read and rejects nothing */ }
  }
  return rest;
}

export async function updateSettings(patch) {
  const op = _settingsLock.then(async () => {
    const writes = await divertMindsKey(diffSettingsForWrite(patch, _lastFetchedSettings));
    const keys = Object.keys(writes);
    let updated = keys;

    // null deletes the stored row so server defaults apply; an empty string would persist an
    // overriding row.
    // Delete before PUT repoints providers: a failed delete then aborts safely, and a failed PUT
    // leaves the old
    // provider using its defaults. Ignore only 404 (absent row) and 400 (older server); skip keys
    // never fetched.
    const tombstones = Object.keys(patch).filter(
      (k) => patch[k] === null && CLIENT_TO_SERVER[k] && k in _lastFetchedSettings,
    );
    for (const k of tombstones) {
      try {
        await req(`/settings/${encodeURIComponent(CLIENT_TO_SERVER[k])}`, { method: 'DELETE' });
      } catch (err) {
        if (err?.status === 400 || err?.status === 404) continue;
        const e = new Error(`Failed to save settings: ${err?.message || String(err)}`);
        e.failed = [k];
        throw e;
      }
    }

    if (keys.length > 0) {
      // Write transactionally so failure cannot leave partially saved settings.
      try {
        const res = await req('/settings/', { method: 'PUT', body: JSON.stringify({ values: writes }) });
        if (Array.isArray(res?.updated)) updated = res.updated;
      } catch (err) {
        const e = new Error(`Failed to save settings: ${err?.message || String(err)}`);
        e.failed = keys;
        throw e;
      }
    }

    // Re-fetch so _lastFetchedSettings reflects the server's canonical state
    // (including any server-side defaults).
    try {
      const rows = await req('/settings/');
      _lastFetchedSettings = transformSettingsRows(rows);
    } catch { /* keep prior snapshot */ }

    try {
      const v = await req('/settings/validate', { method: 'POST', body: JSON.stringify({}) });
      return { status: 'ok', updated, configReady: v.configReady, configError: v.configError };
    } catch {
      return { status: 'ok', updated };
    }
  });
  _settingsLock = op.catch(() => {});
  return op;
}

export async function validateSettings() {
  return req('/settings/validate', { method: 'POST', body: JSON.stringify({}) });
}

export async function testProviders(providers) {
  const body = Array.isArray(providers) ? { providers } : {};
  try {
    return await req('/settings/test-providers', { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    return { providerStatus: {}, providerStatusDetails: {}, error: err?.message || 'Test failed' };
  }
}

export async function revealSettingKey(name) {
  // Secret reveal is loopback-only; hosted requests would always receive 403.
  if (host.isWeb) return '';
  try {
    const res = await req(`/settings/reveal-key/${encodeURIComponent(name)}`);
    return res?.value || '';
  } catch {
    return '';
  }
}

export { labelCategory, countNonEmptyMemory, findMemoryEntry } from './lib/memoryTransform';

// ─── Anton Utilities ────────────────────────────────────────────────────────
export async function fetchMemory(projectRef, { forceFresh = false } = {}) {
  const projectId = await resolveProjectId(projectRef, fetchProjects);
  const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  // Coalesce concurrent memory reads for the same project.
  return dedupe(`memory${suffix}`, async () => {
    const [items, projects] = await Promise.all([
      req(`/memory/${suffix}`),
      fetchProjects(),
    ]);
    const list = Array.isArray(items) ? items : [];
    return groupMemoryItems(list, projects);
  }, { forceFresh });
}

export async function saveMemory(payload) {
  const body = buildMemoryWritePayload(payload);
  return req('/memory/', { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteMemory(payload) {
  const body = buildMemoryDeletePayload(payload);
  return req('/memory/', { method: 'DELETE', body: JSON.stringify(body) });
}

export async function fetchSkills() {
  return req('/skills/');
}

export async function saveSkill(payload, isEdit = false) {
  if (isEdit) {
    return req(`/skills/${encodeURIComponent(payload.label)}`, { method: 'PUT', body: JSON.stringify(payload) });
  }
  return req('/skills', { method: 'POST', body: JSON.stringify(payload) });
}

export async function uploadSkillFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await authFetch(BASE + '/skills/upload', { method: 'POST', body: form });
  if (!res.ok) throw await responseError(res, `Upload failed (${res.status})`);
  return res.json();
}

export async function deleteSkill(label) {
  return req(`/skills/${encodeURIComponent(label)}`, { method: 'DELETE' });
}

// Sweep a staged skill draft (after Save or dismiss). Idempotent server-side —
// a missing draft is a no-op — so callers can fire-and-forget.
export async function deleteSkillDraft(projectName, slug) {
  return req(`/projects/${enc(projectName)}/skill_drafts/${enc(slug)}`, { method: 'DELETE' });
}

export async function fetchDatasources() {
  const data = await req('/connectors/connections/');
  return { connections: Array.isArray(data) ? data : [] };
}

// Deprecated: retired ConnectView still imports these stubs. Remove with that view; saves now use
// streamDataVaultSubmission.
export async function saveDatasource(_payload) {
  console.warn('saveDatasource() is deprecated — use streamDataVaultSubmission instead');
  return { ok: true };
}

export async function validateDatasource(_payload) {
  console.warn('validateDatasource() is deprecated — use streamDataVaultSubmission instead');
  return { valid: true };
}

export async function deleteDatasource(engine, name) {
  return req(`/connectors/connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Remove this project’s picked-file grant; grants for other projects remain.
export async function deletePickedFile(engine, name, fileId, project) {
  const qs = new URLSearchParams({ project });
  return req(`/connectors/connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}/picked-files/${encodeURIComponent(fileId)}?${qs.toString()}`, { method: 'DELETE' });
}

// Returns { engine, name, createdAt, updatedAt, secureKeys, fields }. fields contains non-secrets
// and
// ANTON_VAULT_KEEP for secrets; the server preserves those sentinels on save. Empty strings
// explicitly clear values.
export async function fetchSavedConnection(engine, name) {
  return req(`/connectors/connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`);
}

// Keep in sync with anton.core.datasources.data_vault.ANTON_VAULT_KEEP; unchanged secret fields
// round-trip this value.
export const ANTON_VAULT_KEEP = '__anton_vault_keep__';

// Keep in sync with cowork.services.connectors.identity.VAULT_KEEP_SENTINEL.
// Connections editing uses this distinct sentinel, not the data-vault value above.
export const CONNECTIONS_VAULT_KEEP = 'ANTON_VAULT_KEEP';

// Connector registry: list returns summaries, get retrieves a spec, and match ranks by exact
// ID/alias then token overlap without an LLM.

// In org mode, includeUnavailable includes desktop-only connectors with cloud_available: false.
// Older servers omit the flag, which callers treat as available.
export async function fetchConnectors({ includeUnavailable = false } = {}) {
  try {
    const path = includeUnavailable
      ? '/connectors/specs?include_unavailable=true'
      : '/connectors/specs';
    const data = await req(path);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchConnector(id) {
  return req(`/connectors/specs/${encodeURIComponent(id)}`);
}

export async function matchConnector(query, maxCandidates = 3) {
  return req('/connectors/specs/match', {
    method: 'POST',
    body: JSON.stringify({ query, max_candidates: maxCandidates }),
  });
}

// Use connector-declared schemas; the legacy registry rejects OAuth/service-account credential
// shapes.
export async function saveConnector(connectorId, payload) {
  const body = JSON.stringify({ connector_id: connectorId, ...(payload || {}) });
  return req('/connectors/connections/save', { method: 'POST', body });
}

// Personal-token setup for Code's developer connectors. Unlike the OAuth-only
// save route above, the server verifies the credential with the provider before
// creating a vault record, so an invalid token can never appear connected.
export async function validateAndSaveConnector(connectorId, payload) {
  const body = JSON.stringify({ connector_id: connectorId, ...(payload || {}) });
  return req('/connectors/connections/validate-and-save', { method: 'POST', body });
}

// Web connector OAuth starts server-side PKCE, opens authUrl, then polls for success/error.
// The server exchanges the code and saves credentials; the SPA never handles OAuth codes or tokens.

export async function startConnectorOAuth(connectorId, { method, name, clientId, clientSecret, extraFields } = {}) {
  return req(`/connectors/oauth/${encodeURIComponent(connectorId)}/start`, {
    method: 'POST',
    body: JSON.stringify({
      method: method || null,
      name: name || '',
      client_id: clientId || '',
      client_secret: clientSecret || '',
      extra_fields: extraFields || {},
    }),
  });
}

export async function pollConnectorOAuth(state) {
  return req(`/connectors/oauth/status?state=${encodeURIComponent(state)}`);
}

export async function fetchPublishable() {
  return req('/publish');
}

export async function discoverPostHogProjects({ personalApiKey, host, customHost }) {
  return req('/connectors/posthog/projects', {
    method: 'POST',
    body: JSON.stringify({
      personal_api_key: personalApiKey,
      host,
      custom_host: customHost || null,
    }),
  });
}

// Stage and validate vault values server-side, then stream text, data-vault-form-patch, and
// completion status
// through the chat callbacks. Field values must never appear in the response.
export function streamDataVaultSubmission({
  formId, conversationId, formSpec, values, skipped, name, method,
  onChunk, onProgress, onToolResult, onDone, onError, onEvent,
} = {}) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await authFetch(`${BASE}/connectors/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: formId,
          conversation_id: conversationId || null,
          name: name || formSpec?._existing_name || formSpec?.name || '',
          method: method || null,
          values: values || {},
          skipped: skipped || [],
          form_spec: formSpec || null,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw await responseError(res, `Form submit failed (${res.status})`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let cid = conversationId || null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const block of events) {
          const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const raw = dataLine.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let msg;
          try { msg = JSON.parse(raw); } catch { continue; }

          onEvent?.(msg);

          switch (msg.type) {
            case 'response.created':
              cid = msg.conversation_id || cid;
              break;
            case 'response.output_text.delta':
              onChunk?.(msg.delta || '', cid);
              break;
            case 'response.in_progress': {
              const role = msg.thought_role || '';
              if (role === 'thought.scratchpad.result') {
                onToolResult?.({
                  type: 'tool_result',
                  name: msg.tool_name || '',
                  action: msg.tool_action || '',
                  content: msg.content || '',
                }, cid);
              } else {
                onProgress?.({
                  type: 'progress',
                  phase: msg.phase || role.replace(/^thought\./, '') || 'progress',
                  message: msg.message || msg.content || '',
                  thoughtRole: role,
                }, cid);
              }
              break;
            }
            case 'response.completed':
              onDone?.(cid, msg);
              return;
            case 'response.failed':
              onError?.(msg.error || msg.message || 'Form processing failed', msg);
              return;
            default:
              break;
          }
        }
      }
      onDone?.(cid);
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err.message);
    }
  })();
  return ctrl;
}

// Compatibility wrapper for callers that do not consume the submission stream.
export async function submitDataVaultForm({ formId, conversationId, values, skipped, formSpec, name, method }) {
  const res = await authFetch(`${BASE}/connectors/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_id: formId,
      conversation_id: conversationId || null,
      name: name || formSpec?._existing_name || formSpec?.name || '',
      method: method || null,
      values: values || {},
      skipped: skipped || [],
      form_spec: formSpec || null,
    }),
  });
  if (!res.ok) throw await responseError(res, `Form submit failed (${res.status})`);
  const text = await res.text();
  return { status: 'streamed', body: text };
}

// `access` (optional): a publish-mode object, one of
//   { mode: 'public' }
//   { mode: 'password', password: '...' }
//   { mode: 'restricted', emails: [...], org_allowed: bool }
// Public (or a falsy access) sends just `{ path }`, which clears any prior
// protection on re-publish.
export async function publishArtifact(path, access) {
  const body = access && access.mode && access.mode !== 'public' ? { path, access } : { path };
  return req('/publish', { method: 'POST', body: JSON.stringify(body) });
}

// Re-publish an already-published artifact: pushes current files to the same
// URL with the same access settings (server reuses report_id). Clears the
// "Modified" badge on success.
export async function updateArtifact(path) {
  return req('/publish/update', { method: 'POST', body: JSON.stringify({ path }) });
}

// Version history of a live artifact:
//   { reportId, currentMd5, artifactType, versions: [{ md5, publishedAt, title, isCurrent }] }
// Versions are newest-first. Throws on 404 — which is also what an older server
// (no /versions route) returns, so callers feature-detect by treating any error
// as "no history available" and hiding the UI.
export async function listArtifactVersions(path) {
  return req(`/publish/versions?path=${encodeURIComponent(path)}`);
}

// Roll the live URL back to an existing version (flips current_md5 — the public
// URL is stable). Static artifacts only; the server rejects fullstack apps.
export async function activateArtifactVersion(path, md5) {
  return req('/publish/activate', { method: 'POST', body: JSON.stringify({ path, md5 }) });
}

// Prefer the artifact folder so publication includes the whole artifact; legacy loose files fall
// back to their primary path.
export function publishTargetPath(artifact) {
  return artifact?.folder
    || artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
}

export async function fetchBrowseStatus() {
  return req('/browse/status');
}

// Channel plugins advertise credential schemas and capabilities. Reads mask secrets as
// is_set/value:null; writes carry replacements.

export async function fetchChannelPlugins() {
  try {
    const data = await req('/channels/plugins');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchChannelStatus() {
  try {
    return await req('/channels/status');
  } catch {
    return { plugin_count: 0, installation_count: 0, channels: [] };
  }
}

export async function fetchChannelInstallations() {
  try {
    const data = await req('/channels/installations');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// The harness that serves channel conversations (separate from the desktop
// harness). Returns the current value plus the registered options.
export async function fetchChannelAgent() {
  try {
    return await req('/channels/agent');
  } catch {
    return { harness: '', options: [] };
  }
}

export async function setChannelAgent(harness) {
  return req('/channels/agent', { method: 'PUT', body: JSON.stringify({ harness }) });
}

export async function fetchChannelConfig(channelType) {
  return req(`/channels/${enc(channelType)}/config`);
}

export async function saveChannelConfig(channelType, values) {
  return req(`/channels/${enc(channelType)}/config`, {
    method: 'PUT',
    body: JSON.stringify({ values: values || {} }),
  });
}

export async function deleteChannelConfig(channelType) {
  return req(`/channels/${enc(channelType)}/config`, { method: 'DELETE' });
}

// Rebuild the live adapter from stored config (no webhook registration).
export async function reloadChannel(channelType) {
  return req(`/channels/${enc(channelType)}/reload`, { method: 'POST' });
}

// Register the channel's inbound endpoint with the platform (Telegram setWebhook).
// 501 when the channel has no lifecycle (gate on capabilities.supports_webhook_setup).
export async function setupChannel(channelType) {
  return req(`/channels/${enc(channelType)}/setup`, { method: 'POST' });
}

export async function teardownChannel(channelType) {
  return req(`/channels/${enc(channelType)}/teardown`, { method: 'POST' });
}

// Calls the platform with the STORED credentials — proof they actually
// authenticate, not just that every required field has some value typed in.
// Gate on capabilities.supports_verify.
export async function testChannelConnection(channelType) {
  return req(`/channels/${enc(channelType)}/test-connection`, { method: 'POST' });
}

// ── Channel bindings (wire an external chat/thread to a project/conversation) ──

export async function fetchChannelBindings(channelType) {
  const suffix = channelType ? `?channel_type=${enc(channelType)}` : '';
  try {
    const data = await req(`/channels/bindings${suffix}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function createChannelBinding(payload) {
  return req('/channels/bindings', { method: 'POST', body: JSON.stringify(payload || {}) });
}

export async function updateChannelBinding(bindingId, patch) {
  return req(`/channels/bindings/${enc(bindingId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
}

export async function deleteChannelBinding(bindingId) {
  return req(`/channels/bindings/${enc(bindingId)}`, { method: 'DELETE' });
}

// ─── Attachments And Context ───────────────────────────────────────────────

/** POST /v1/attachments/{project_name}/{session_id}/upload — response body is a JSON array of file attachments. */
export async function uploadAttachments(files, { projectName, sessionId } = {}) {
  if (!projectName || !sessionId) {
    throw new Error('Open a saved task before attaching files (project and conversation id are required).');
  }
  const enc = encodeURIComponent;
  const form = new FormData();
  Array.from(files).forEach((file) => form.append('files', file));
  const res = await authFetch(
    `${BASE}/attachments/${enc(projectName)}/${enc(sessionId)}/upload`,
    { method: 'POST', body: form },
  );
  if (!res.ok) throw await responseError(res, `Attachment upload failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** GET /v1/attachments/{project_name}/{session_id} — response body is a JSON array. */
export async function fetchAttachments(projectName, sessionId, { ids } = {}) {
  if (!projectName || !sessionId) {
    return { attachments: [] };
  }
  const enc = encodeURIComponent;
  const qs = new URLSearchParams();
  if (Array.isArray(ids) && ids.length) {
    for (const id of ids) {
      if (id) qs.append('ids', id);
    }
  }
  const q = qs.toString();
  const path = `/attachments/${enc(projectName)}/${enc(sessionId)}${q ? `?${q}` : ''}`;
  const data = await req(path);
  const raw = Array.isArray(data) ? data : [];
  return { attachments: raw };
}

export async function deleteAttachment(id, { projectName, sessionId } = {}) {
  // Use the scoped path when available; the legacy ID-only route consults state that uploads do not
  // populate.
  if (projectName && sessionId && id) {
    const enc = encodeURIComponent;
    return req(`/attachments/${enc(projectName)}/${enc(sessionId)}/${enc(id)}`, { method: 'DELETE' });
  }
  // Retain the ID-only route for legacy callers without project/session coordinates.
  return req(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Absolute inline-file URL for browser image/PDF/text preview, usable through host.openExternal in
 * either shell.
 */
export function attachmentRawUrl(projectName, sessionId, attachmentId) {
  if (!projectName || !sessionId || !attachmentId) return null;
  const enc = encodeURIComponent;
  return `${BASE}/attachments/${enc(projectName)}/${enc(sessionId)}/${enc(attachmentId)}/raw`;
}

/**
 * Returns { ok, project_path, absolute_path }. Refresh both task uploads and project files:
 * promotion moves the file between them.
 */
export async function moveAttachmentToProject(projectName, sessionId, attachmentId) {
  if (!projectName || !sessionId || !attachmentId) {
    throw new Error('projectName, sessionId, and attachmentId are required.');
  }
  const enc = encodeURIComponent;
  return req(
    `/attachments/${enc(projectName)}/${enc(sessionId)}/${enc(attachmentId)}/move-to-project`,
    { method: 'POST' },
  );
}

// ─── Search, Pins, Schedules ───────────────────────────────────────────────
export async function searchCowork(query) {
  if (!query.trim()) return { results: [] };
  return req(`/search?q=${encodeURIComponent(query)}`);
}

export async function fetchPins() {
  try {
    return await req('/pins/');
  } catch {
    return { pins: [] };
  }
}

export async function pinTask(task) {
  return req('/pins/', { method: 'POST', body: JSON.stringify({ item_type: 'conversation', item_id: task.id, title: task.title }) });
}

export async function unpinTask(id) {
  return req(`/pins/${encodeURIComponent(id)}?item_type=conversation`, { method: 'DELETE' });
}

export async function renameConversation(id, title) {
  return req(`/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

/** PATCH conversation meta (`title`, `project`, `disabled_connections`, …). */
export async function patchConversation(id, body) {
  return req(`/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// Delete a user/assistant cycle including internal tool blocks. turnIndex is the zero-based
// displayable bubble index used by the event sidecar.
export async function deleteConversationTurn(id, turnIndex) {
  const res = await authFetch(
    BASE + `/conversations/${encodeURIComponent(id)}/turns/${turnIndex}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  if (res.status === 404) return { status: 'gone', id, turnIndex };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete turn failed (${res.status})`);
  }
  return res.json();
}

export async function deleteConversation(id) {
  // Treat 404 as success: retries and concurrent clients may already have deleted the conversation.
  const res = await authFetch(BASE + `/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return { status: 'gone', id };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete failed (${res.status})`);
  }
  if (res.status === 204) return { ok: true };
  return res.json();
}

export async function moveConversation(id, projectName) {
  return req(`/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ project: projectName }),
  });
}

// The destination project must already exist. moveObjects also relocates task artifacts and retags
// files.
export async function moveTaskToProject(id, projectName, moveObjects = true) {
  return req(`/conversations/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    body: JSON.stringify({ project: projectName, moveObjects }),
  });
}

export async function recordTaskVisit(task, autoPin = false) {
  const params = new URLSearchParams({ auto_pin: autoPin ? 'true' : 'false' });
  if (task?.title) params.set('title', task.title);
  return req(`/pins/${encodeURIComponent(task.id)}/visit?${params.toString()}`, { method: 'POST' });
}

export async function fetchSchedules() {
  try {
    return await req('/schedules/');
  } catch {
    return { schedules: [] };
  }
}

export async function createSchedule(payload) {
  return req('/schedules/', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateSchedule(id, payload) {
  return req(`/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteSchedule(id) {
  return req(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function pauseSchedule(id) {
  return req(`/schedules/${encodeURIComponent(id)}/pause`, { method: 'POST' });
}

export async function resumeSchedule(id) {
  return req(`/schedules/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

export async function runScheduleNow(id) {
  return req(`/schedules/${encodeURIComponent(id)}/run-now`, { method: 'POST' });
}

export async function fetchScheduleRuns(id, { limit = 100 } = {}) {
  // Returns { runs: [{ id, scheduleId, startedAt, finishedAt, durationMs,
  // status, error, conversationId, isManual }] }
  // Newest first.
  try {
    return await req(`/schedules/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(limit)}`);
  } catch {
    return { schedule_id: id, runs: [] };
  }
}

// ─── Mock data (used when server is offline) ──────────────────────────────────
export const MOCK_DATA = {
  tasks: [
    {
      id: 't1',
      title: 'Communicate RIF to remaining team',
      subtitle: '6 days ago',
      status: 'active',
      messages: [
        {
          role: 'user',
          content: 'Help me draft a message to the remaining team about the RIF. Keep it human, factual, no corporate fluff. We need to acknowledge what happened last week, address the immediate questions, and outline next steps.',
        },
        {
          role: 'assistant',
          content: "I pulled the latest from your Operational ops project — the RIF announcement v3 doc and last week's all-hands transcript. Here's a draft. I kept it to three short sections, with the practical info up top.",
          artifact: {
            title: 'RIF — message to remaining team',
            kind: 'Document', icon: 'doc',
            progress: 72,
            preview: [
              { heading: "What's changed" },
              { text: "Last Thursday we said goodbye to 14 colleagues across infra and ops. The decision was based on where we're investing for the next 18 months — primarily AI Fab and the Minds platform." },
              { heading: 'What this means for you' },
              { text: 'Reporting lines stay the same this quarter. New squad assignments will be shared by Monday.' },
            ],
          },
        },
      ],
    },
    { id: 't2', title: 'Determine Lightsail instance for AI Fab', subtitle: '7 days ago', status: 'idle', messages: [
      { role: 'user', content: 'Determine Lightsail instance for AI Fab' },
      { role: 'assistant', content: 'Picking this back up — I have the project context loaded. Where would you like to start?' },
    ]},
    { id: 't3', title: 'Review RIF announcement presentation', subtitle: '1 week ago', status: 'idle', messages: [
      { role: 'user', content: 'Review RIF announcement presentation' },
      { role: 'assistant', content: 'Picking this back up — I have the project context loaded. Where would you like to start?' },
    ]},
    { id: 't4', title: 'Write website copy for agent platform', subtitle: '2 weeks ago', status: 'done', messages: [
      { role: 'user', content: 'Write website copy for agent platform' },
      { role: 'assistant', content: 'Done — copy is in your Artifacts.' },
    ]},
    { id: 't5', title: 'Create website copy for MindsHub Cowork', subtitle: '2 weeks ago', status: 'done', messages: [
      { role: 'user', content: 'Create website copy for MindsHub Cowork' },
      { role: 'assistant', content: 'Done — copy is in your Artifacts.' },
    ]},
    { id: 't6', title: 'Create MindsDB website copy positioning', subtitle: '3 weeks ago', status: 'done', messages: [] },
    { id: 't7', title: 'Redesign presentation slide from doc', subtitle: '3 weeks ago', status: 'idle', messages: [] },
    { id: 't8', title: 'Create operational plan with milestones', subtitle: '1 month ago', status: 'done', messages: [] },
  ],

  projects: [
    { id: 'p1', name: 'AI Fab launch', description: 'Hardware, infra, and brand for the AI Fab', taskCount: 14, fileCount: 23, updated: '2h ago', tint: 'rgba(31,156,176,0.12)', color: 'var(--primary-700)' },
    { id: 'p2', name: 'MindsDB website', description: 'Marketing site copy + positioning', taskCount: 9, fileCount: 41, updated: 'Yesterday', tint: 'rgba(72,190,227,0.14)', color: 'var(--ocean-700)' },
    { id: 'p3', name: 'Cowork brand', description: 'Brand and identity for the MindsHub Cowork app', taskCount: 6, fileCount: 12, updated: '3d ago', tint: 'rgba(120,186,172,0.18)', color: 'var(--sage-700)' },
    { id: 'p4', name: 'Operational ops', description: 'Internal ops, RIF, hiring plans', taskCount: 11, fileCount: 8, updated: '1w ago', tint: 'rgba(244,177,131,0.15)', color: '#B7522B' },
  ],

  artifacts: [
    { id: 'a1', title: 'RIF announcement — v3', kind: 'Document', updated: 'updated 4m ago', live: true, bg: 'linear-gradient(135deg, var(--stone-100), var(--surface-03))', snippet: "Team,\n\nAs we mentioned in last\nweek's all-hands, we are\nrestructuring our…" },
    { id: 'a2', title: 'Lightsail cost projection', kind: 'Spreadsheet', updated: 'updated 1h ago', live: true, bg: 'linear-gradient(135deg, var(--ocean-50), #fff)', snippet: 'instance | type   | $/mo\n--------+--------+-----\n  ai-01 | xlarge |  84\n  ai-02 | medium |  42' },
    { id: 'a3', title: 'Cowork landing — copy v2', kind: 'Document', updated: 'updated yesterday', live: false, bg: 'linear-gradient(135deg, var(--sage-50), #fff)', snippet: "A teammate that knows your\ncompany. Anton works in your\nprojects, with your data, on\nyour cadence." },
    { id: 'a4', title: 'AI Fab brand explorations', kind: 'Canvas', updated: 'updated 2d ago', live: false, bg: 'linear-gradient(135deg, #fff, var(--stone-150))', snippet: '◇ logomark draft 04\n◇ wordmark v2\n◇ palette — aqua x stone' },
  ],

  scheduled: [
    { id: 's1', title: 'Daily — pull GitHub PR digest', cadence: 'Every weekday at 9:00', nextRun: 'tomorrow 9:00', enabled: true },
    { id: 's2', title: 'Weekly — sales pipeline summary', cadence: 'Mondays at 8:30', nextRun: 'Mon 8:30', enabled: true },
    { id: 's3', title: 'Hourly — monitor Lightsail spend', cadence: 'Every hour', nextRun: 'in 24m', enabled: false },
  ],

  settings: {
    greeting: "Let's knock something off your list",
    tone: 'balanced',
    defaultModel: 'latest:sonnet',
    autoPin: true,
    // Flat background by default; opt back into the animated dot grid via
    // Settings → Personalization → Animated background.
    showDots: false,
    showCounters: true,
    accentVariant: 'aqua',
    planningProvider: 'minds-cloud',
    planningModel: 'latest:sonnet',
    codingProvider: 'minds-cloud',
    codingModel: 'latest:haiku',
    memoryEnabled: true,
    memoryMode: 'autopilot',
    episodicMemory: true,
    proactiveDashboards: false,
    actFirst: true,
    anthropicApiKey: '',
    openaiApiKey: '',
    providers: [],
    modelMode: 'default',
    modelOverrides: {},
    providerTypes: ['minds-cloud', 'anthropic', 'openai', 'gemini', 'openai-compatible'],
    providerTypeLabels: {
      'minds-cloud': 'MindsHub',
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      gemini: 'Gemini',
      'openai-compatible': 'OpenAI-compatible',
    },
    recommendedModels: {},
    recommendedPair: {},
    providerStatus: {},
  },
};

// Scope artifact comments by {userDir}/{reportId}. The server supplies MindsHub credentials; the
// renderer holds no comment token.

function _commentsBase(userDir, reportId) {
  return `/artifact-comments/${encodeURIComponent(userDir)}/${encodeURIComponent(reportId)}`;
}

export function listCommentThreads(userDir, reportId, status = 'open') {
  return req(`${_commentsBase(userDir, reportId)}/threads?status=${encodeURIComponent(status)}`);
}

export function createCommentThread(userDir, reportId, {
  selector, text, revisionId = null, kind = 'review',
}) {
  return req(`${_commentsBase(userDir, reportId)}/threads`, {
    method: 'POST',
    body: JSON.stringify({ selector: selector ?? null, text, revisionId, kind }),
  });
}

export function addCommentReply(userDir, reportId, threadId, text) {
  return req(`${_commentsBase(userDir, reportId)}/threads/${encodeURIComponent(threadId)}/replies`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function setCommentThreadStatus(userDir, reportId, threadId, status) {
  return req(`${_commentsBase(userDir, reportId)}/threads/${encodeURIComponent(threadId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function markCommentsRead(userDir, reportId) {
  return req(`${_commentsBase(userDir, reportId)}/read`, {
    method: 'POST',
    body: '{}',
  });
}

export function editCommentThread(userDir, reportId, threadId, text) {
  return req(`${_commentsBase(userDir, reportId)}/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
}

export function deleteCommentThread(userDir, reportId, threadId) {
  return req(`${_commentsBase(userDir, reportId)}/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
  });
}

export function editCommentReply(userDir, reportId, threadId, replyId, text) {
  return req(
    `${_commentsBase(userDir, reportId)}/threads/${encodeURIComponent(threadId)}/replies/${encodeURIComponent(replyId)}`,
    { method: 'PATCH', body: JSON.stringify({ text }) },
  );
}

export function deleteCommentReply(userDir, reportId, threadId, replyId) {
  return req(
    `${_commentsBase(userDir, reportId)}/threads/${encodeURIComponent(threadId)}/replies/${encodeURIComponent(replyId)}`,
    { method: 'DELETE' },
  );
}

// Use fetch because EventSource cannot set the required headers. Abort on unmount; onExpired
// handles
// terminal 401/403 responses so callers stop reconnecting.
export function openCommentsStream(userDir, reportId, since, { onEvent, onError, onExpired } = {}) {
  const ctrl = new AbortController();
  (async () => {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    const url = `${BASE}${_commentsBase(userDir, reportId)}/stream${q}`;
    try {
      const res = await authFetch(url, { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) { onExpired && onExpired(); return; }
      if (!res.ok || !res.body) { onError && onError(new Error(`stream ${res.status}`)); return; }
      for await (const ev of iterateSSE(res)) {
        if (ev && ev.type && String(ev.type).indexOf('thread.') === 0) onEvent && onEvent(ev);
      }
      // Stream ended without an abort (proxy/nginx idle-close, server restart) —
      // signal so the caller can reconnect with the latest `since`.
      if (!ctrl.signal.aborted) onError && onError(new Error('stream ended'));
    } catch (e) {
      if (!ctrl.signal.aborted) onError && onError(e);
    }
  })();
  return ctrl;
}
