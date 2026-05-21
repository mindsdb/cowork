// API client — talks to the FastAPI backend at /v1/*.
// Port matches antontron's server-process default (26866 = ANTON on T9
// keypad). Vite dev would proxy /v1 → backend; packaged Electron runs
// from file:// or app:// and must address the loopback server directly.

import { initialStreamState, reduceStream } from './lib/responseStreamAdapter';

const ANTON_SERVER_PORT = 26866;

const API_ORIGIN = (() => {
  if (typeof window === 'undefined') return '';
  const protocol = window.location?.protocol;
  // Packaged Electron (file:// or app://) OR dev Electron (http:// but
  // window.antontron is present — Electron injected the preload bridge)
  if (
    protocol === 'file:' ||
    protocol === 'app:' ||
    typeof window.antontron !== 'undefined'
  ) {
    return `http://127.0.0.1:${ANTON_SERVER_PORT}`;
  }
  return '';
})();

export const BASE = `${API_ORIGIN}/v1`;
const ROOT_BASE = `${API_ORIGIN}`;

/**
 * Absolute origin of the antontron API, suitable for building redirect URLs
 * that must be reached from outside the app (e.g. Slack OAuth callback).
 *
 *   Electron:           "http://127.0.0.1:26866"  (Python child process)
 *   Web (vite/dev):     window.location.origin    ("http://localhost:5173")
 *   Web (docker/prod):  window.location.origin    ("https://cw-*.localhost")
 *
 * Always returns a usable absolute origin; never an empty string.
 */
export function getApiOrigin() {
  if (API_ORIGIN) return API_ORIGIN;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
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
    throw new Error(detail || `API ${path} returned ${res.status}`);
  }
  return res.json();
}

async function rootReq(path, options = {}) {
  const res = await fetch(ROOT_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  return res.json();
}

// In-flight single-flight cache. When several call sites ask for
// the same endpoint at the same time (e.g. WorkingFolderLive and
// ContextCard both mounting at once and both calling
// `listProjectFiles(name)`, or the projects list view fanning N
// rows that all want `fetchArtifacts`), we collapse the duplicates
// into one network request and share its promise.
//
// Behaviour:
//   - First caller for a given key starts the request.
//   - Concurrent callers receive the SAME promise.
//   - Once the promise settles (resolve or reject) the entry is
//     deleted so the next call will re-fetch — i.e. NO long-lived
//     cache, just request coalescing within the same tick / async
//     window. Streaming polls keep working.
//
// The keys are constructed by callers; convention is the URL path
// plus any query params, so different projects never collide.
const _inflight = new Map();
function dedupe(key, factory) {
  const existing = _inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await factory();
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, p);
  return p;
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

// ─── Health ──────────────────────────────────────────────────────────────────
export async function fetchHealth() {
  try {
    return await rootReq('/health');
  } catch {
    return { status: 'offline', anton_available: false };
  }
}

// ─── Conversations (Tasks) ──────────────────────────────────────────────────
// Cowork's "task" object is the merge of an Anton conversation (id, title,
// preview, project_path, messages) with cowork-side UI state (pinned,
// attachments). The shape returned here mirrors what App.jsx already
// expects so callers don't need to change.

function _humanTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)} days ago`;
  return `${Math.floor(secs / 604800)} weeks ago`;
}

// Replay the server-persisted SSE event log through the live stream
// reducer to reconstruct `steps` + `startedAt` for each assistant
// turn. The server saves raw events in a sidecar file and returns
// them inline on `/conversations/{id}/messages`; doing the replay
// here keeps reducer logic single-source (lib/responseStreamAdapter).
function _hydrateAssistantEvents(messages) {
  if (!Array.isArray(messages)) return messages || [];
  return messages.map((m) => {
    if (m?.role !== 'assistant') return m;
    const events = m.events;
    if (!Array.isArray(events) || events.length === 0) return m;
    let state = initialStreamState();
    for (const ev of events) {
      try { state = reduceStream(state, ev); } catch {}
    }
    const { events: _drop, ...rest } = m;
    if (!state.steps || state.steps.length === 0) return rest;
    return {
      ...rest,
      steps: state.steps,
      startedAt: rest.startedAt || state.startedAt || null,
    };
  });
}

function _conversationToTask(conv, messages = []) {
  // Server stores conversations under <project>/.anton/episodes/ and
  // returns the project NAME on each conversation meta. We carry both:
  //   projectName — the canonical id from the server
  //   projectPath — resolved later from the projects list (App.jsx)
  //
  // Each assistant message may carry an `events` array — the SSE log
  // captured server-side for that turn. Replaying it through the live
  // reducer gives us back `steps` + `startedAt` byte-for-byte. We do
  // the replay at the api boundary so the rest of the app sees a
  // consistent message shape regardless of whether the data came from
  // a fresh stream or a server reload.
  const rawDisabled = conv.disabled_connections ?? conv.disabledConnections;
  const disabledConnections = Array.isArray(rawDisabled)
    ? rawDisabled
      .filter((x) => x && typeof x.engine === 'string' && typeof x.name === 'string')
      .map((x) => ({ engine: x.engine.trim(), name: x.name.trim() }))
    : [];

  return {
    id: conv.id,
    title: conv.title || conv.preview || conv.id || 'Untitled task',
    subtitle: _humanTime(conv.updated_at || conv.created_at),
    status: 'idle',
    messages: _hydrateAssistantEvents(messages),
    projectName: conv.project || null,
    projectPath: conv.project_path || null,
    model: null,
    attachments: [],
    disabledConnections,
    pinned: false,
    // Carry the schedule linkage through so the renderer can group
    // multiple runs of the same schedule into a single "view all"
    // row instead of showing each execution as its own task. Set on
    // conversations created by `_run_schedule`; null for chat-
    // initiated conversations.
    scheduledId: conv.scheduled_id || conv.scheduledId || null,
    updatedAt: conv.updated_at || conv.updatedAt || null,
    createdAt: conv.created_at || conv.createdAt || null,
  };
}

export async function fetchSessions() {
  try {
    // Critical: pass `project=all` so we list conversations across
    // every project, not just the active one. Without this, a task
    // created in project A vanishes from `tasks` the moment we
    // refresh while the user is "in" project B (because the server
    // defaults to the active project's episodes/ dir).
    const list = await req('/conversations?project=all&limit=200');
    const conversations = Array.isArray(list?.conversations) ? list.conversations : [];
    if (conversations.length === 0) return [];
    // Fan out for the most recent N — full message history isn't
    // needed for the sidebar/projects-list rendering, but loading
    // it eagerly for recent ones keeps clicks instant. Older tasks
    // get an empty messages array; ChatView fetches them on open.
    const EAGER = 50;
    const eager = conversations.slice(0, EAGER);
    const messageBundles = await Promise.all(
      eager.map((c) =>
        req(`/conversations/${encodeURIComponent(c.id)}/messages`)
          .then((r) => Array.isArray(r?.messages) ? r.messages : [])
          .catch(() => [])
      )
    );
    const messagesById = new Map(eager.map((c, i) => [c.id, messageBundles[i]]));
    return conversations.map((c) => _conversationToTask(c, messagesById.get(c.id) || []));
  } catch {
    return [];
  }
}

export async function fetchSession(id) {
  try {
    const [meta, msgs] = await Promise.all([
      req(`/conversations/${encodeURIComponent(id)}`).catch(() => null),
      req(`/conversations/${encodeURIComponent(id)}/messages`).catch(() => null),
    ]);
    if (!meta) return null;
    return _conversationToTask(meta, Array.isArray(msgs?.messages) ? msgs.messages : []);
  } catch {
    return null;
  }
}

/** 
 * Matches server `conversation_manager._new_conversation_id` (UTC) so client can upload before the first stream. 
 * This is required especially when the user uploads files before the first stream, so the server can assign the files to the correct conversation.
*/
export function allocateConversationId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const hex = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 8);
  return `${stamp}_${hex}`;
}

// Streams a /v1/responses request. Maps OpenAI-style typed events to the
// callback shape the rest of the app already speaks. `conversationId` is
// optional — omit it to start a new conversation; the caller learns the
// new id via the first onChunk/onProgress/onDone callback's second arg.
function _streamResponse(text, { conversationId, projectName, projectPath, model, attachmentIds = [], disabledConnections, onChunk, onProgress, onToolResult, onDone, onError, onEvent } = {}) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          model: model || null,
          stream: true,
          conversation: conversationId || null,
          // Server's `project` field is a project NAME (folder under
          // projects_store). Sending project_path is silently ignored —
          // every conversation would fall back to the active project.
          project: projectName || null,
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
              onError?.(msg.error || msg.message || 'Anton failed', { ...msg, code: msg.code });
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

export function streamNewSession(text, opts = {}) {
  return _streamResponse(text, opts);
}

// Phase 2 — reconnect helpers. Built so a tab that mounted on an
// already-streaming conversation can re-attach without restarting
// the turn. The cheap probe (`fetchInFlightStatus`) decides whether
// it's worth opening an SSE; `tailInFlight` reuses the same callback
// signature as `_streamResponse` so the caller's adapter logic
// (onChunk / onProgress / onToolResult / onDone / onError / onEvent)
// is identical between fresh-turn and reconnect paths.
export async function fetchInFlightStatus(conversationId) {
  if (!conversationId) return { in_flight: false, has_buffer: false, latest_seq: 0 };
  try {
    return await req(`/responses/in-flight?conversation_id=${encodeURIComponent(conversationId)}`);
  } catch {
    return { in_flight: false, has_buffer: false, latest_seq: 0 };
  }
}

// Cross-client sync feed (Option B). Returns every conversation_id
// whose producer task is currently running. The renderer mirrors this
// into a local Set so reconcileTaskMessages can synchronously decide
// "is this conversation alive on the server right now?" without a
// per-task probe.
export async function fetchInFlightList() {
  try {
    const res = await req('/responses/in-flight-list');
    return Array.isArray(res?.in_flight) ? res.in_flight : [];
  } catch {
    return [];
  }
}

export function tailInFlight(conversationId, {
  fromSeq = 0,
  model = 'anton',
  onChunk, onProgress, onToolResult, onDone, onError, onEvent,
} = {}) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const url = `${BASE}/responses/tail?conversation_id=${encodeURIComponent(conversationId)}&from_seq=${fromSeq}&model=${encodeURIComponent(model)}`;
      const res = await fetch(url, {
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
              onError?.(msg.error || msg.message || 'Anton failed', { ...msg, code: msg.code });
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

export function streamMessage(sessionId, text, opts = {}) {
  // Strip renderer-side temp ids (`tmp-connect-…` from the connector
  // picker) before they hit the wire — the server has a defensive
  // guard, but skipping the value here means the server doesn't even
  // have to consider it, and the `response.created` event carries
  // the canonical id straight back. The caller's stream consumer
  // (App.jsx adoptServerId) rewrites the local task in place.
  const conversationId = sessionId && !String(sessionId).startsWith('tmp-')
    ? sessionId
    : null;
  return _streamResponse(text, { ...opts, conversationId });
}

// ─── Projects ─────────────────────────────────────────────────────────────────
// Server returns { projects: [{ name, path }] }. Unwrap so call sites
// keep their array contract.
export async function fetchProjects() {
  try {
    const data = await req('/projects');
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

export async function createProject(name) {
  return req('/projects', { method: 'POST', body: JSON.stringify({ name }) });
}

// Rename — backed by PATCH /v1/projects/{name}. Server moves the
// project directory and updates internal references; the response is
// the renamed Project record.
export async function renameProject(oldName, newName) {
  return req(`/projects/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: newName }),
  });
}

// Reveal a project's working folder in Finder. Same backend as
// `revealArtifact` — the endpoint takes any path and dispatches it to
// the OS's native "show in folder" handler.
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

// publishArtifact + previewArtifact live further down in this file.
// We only add the new unpublish endpoint here.
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

// Phase 3 — explicit cancel of an in-flight LLM turn.
//
// Under the new producer/consumer split (Phase 1), aborting the SSE
// fetch only tears down the consumer; the server-side producer keeps
// running. The Stop button needs this dedicated signal to actually
// halt the work.
//
// Idempotent: hitting it for an already-finished conversation returns
// {cancelled: false} rather than failing.
export async function cancelResponse(conversationId) {
  if (!conversationId) return null;
  try {
    return await req('/responses/cancel', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  } catch {
    // 404 / network blip — treat as "already done." The local-state
    // teardown in handleStopStream is the user-visible part anyway.
    return { cancelled: false, conversation_id: conversationId };
  }
}

export async function unpublishArtifact(path) {
  // Idempotent — server 404 means "no record" which is the desired
  // end state.
  const res = await fetch(BASE + `/publish?path=${encodeURIComponent(path)}`, {
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

export async function deleteProject(name) {
  // Idempotent: 404 = "already gone" = success.
  const res = await fetch(BASE + `/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return { status: 'gone', name };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete failed (${res.status})`);
  }
  return res.json();
}

// ── Project files ────────────────────────────────────────────────
//
// Most paths are relative to the project root. Project instructions
// live at ANTON_PROJECT_INSTRUCTIONS_PATH (on disk: `.anton/anton.md`).
// These helpers wrap routes/projects.py.

const enc = encodeURIComponent;

/** Relative path from project root for project instructions (projects file API). */
export const ANTON_PROJECT_INSTRUCTIONS_PATH = '.anton/anton.md';

/** True if `relPath` is the canonical instructions file (`.anton/anton.md`). */
export function isProjectInstructionsPath(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === ANTON_PROJECT_INSTRUCTIONS_PATH;
}

/** Legacy installs: true if `relPath` is under `.context/` (pre-migration tree). */
export function isUnderContextDir(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === '.context' || r.startsWith('.context/');
}

/** True if `relPath` is under the project `.anton/` tree (runtime state, outputs, etc.). */
export function isUnderAntonDir(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === '.anton' || r.startsWith('.anton/');
}

/**
 * Stat just `.anton/anton.md` for the project — far cheaper than
 * `listProjectFiles` when the only thing the caller needs is the
 * canonical instructions row. Returns `{ file: { path, name, size,
 * modified, is_dir, synthetic? } }`. `synthetic: true` means the
 * file doesn't exist on disk yet (renderer should show the "empty,
 * click to author" affordance). Coalesced like `listProjectFiles`.
 */
export async function fetchProjectInstructions(projectName) {
  if (!projectName) return { file: null };
  return dedupe(`projects/${projectName}/instructions`, () =>
    req(`/projects/${enc(projectName)}/instructions`),
  );
}

export async function listProjectFiles(projectName) {
  if (!projectName) return { files: [] };
  // Coalesced — see `dedupe` notes above. WorkingFolderLive +
  // ContextCard mount in the same rail and both call this on open,
  // so without coalescing every project switch fires two identical
  // requests. The cache entry releases on settle, so subsequent
  // streaming polls hit the network normally.
  return dedupe(`projects/${projectName}/files`, () =>
    req(`/projects/${enc(projectName)}/files`),
  );
}

export async function readProjectFile(projectName, path) {
  // `path` may have slashes — encode each segment, not the whole
  // string (encodeURIComponent('a/b') → 'a%2Fb' which the FastAPI
  // route would treat as a single literal segment).
  const safe = path.split('/').map(enc).join('/');
  return req(`/projects/${enc(projectName)}/files/${safe}`);
}

// HTML preview-mount for a project file — server registers the
// parent dir under a token and returns a relative URL the iframe
// should load with `src=`. Mirrors the artifact preview flow.
export async function mountProjectFilePreview(projectName, path) {
  return req(`/projects/preview-mount-file`, {
    method: 'POST',
    body: JSON.stringify({ name: projectName, path }),
  });
}

// Absolute URL for downloading a project file's raw bytes. Server
// sets `Content-Disposition: attachment` so browsers trigger a save
// dialog rather than rendering inline.
export function projectFileDownloadUrl(projectName, path) {
  const safe = path.split('/').map(enc).join('/');
  return `${BASE}/projects/${enc(projectName)}/files-raw/${safe}`;
}

export async function writeProjectFile(projectName, path, content) {
  const safe = path.split('/').map(enc).join('/');
  const res = await fetch(BASE + `/projects/${enc(projectName)}/files/${safe}`, {
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
  // `files` is an iterable of File objects (drag&drop or input).
  // Endpoint accepts a multipart payload with a repeated `files`
  // field — same shape FastAPI's `list[UploadFile]` consumes.
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  const res = await fetch(BASE + `/projects/${enc(projectName)}/files/upload`, {
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
  const res = await fetch(BASE + `/projects/${enc(projectName)}/files/${safe}`, {
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
    const data = await req('/projects/active');
    return data?.name || null;
  } catch {
    return null;
  }
}

export async function setActiveProject(name) {
  return req('/projects/active', { method: 'PUT', body: JSON.stringify({ name }) });
}

// ─── Artifacts ────────────────────────────────────────────────────────────────
// Returns the full system-wide artifact list. Heavy enough that
// callers need to be careful not to fan out: ProjectsView's row
// stats hook calls this from each visible project row, and prior to
// the `dedupe` wrapper that meant N copies of the same request on
// every list render. With coalescing, one network request fans out
// to all subscribers and the cache entry releases on settle.
export async function fetchArtifacts({ projectPath } = {}) {
  // `projectPath` scopes the response to one project's
  // `<base>/artifacts/` tree. Used by the project-detail rail card
  // so the response is small and the server skips reading every
  // other project's metadata.json. Omit it (or pass undefined) for
  // the system-wide list the global Live Artifacts page wants.
  const suffix = projectPath
    ? `?project_path=${encodeURIComponent(projectPath)}`
    : '';
  // Dedupe key includes the path so a global fetch and a scoped
  // fetch don't share an in-flight promise.
  return dedupe(`artifacts${suffix}`, async () => {
    try {
      return await req(`/artifacts${suffix}`);
    } catch {
      return [];
    }
  });
}

export async function previewArtifact(path) {
  return req(`/artifacts/preview?path=${encodeURIComponent(path)}`);
}

// Mount an HTML artifact's parent directory for iframe preview. Returns
// `{ token, entry, relUrl }` — `entry` is the filename, `relUrl` is the
// path the iframe should load (relative to BASE). Use this so relative
// `<script>` / `<link>` refs in the HTML resolve against a real URL.
export async function mountArtifactPreview(path) {
  const data = await req('/artifacts/preview-mount', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
  return {
    token: data?.token,
    entry: data?.entry,
    // Absolute URL the iframe can load directly. The server returns a
    // path without scheme; combine with BASE so the renderer doesn't
    // need to know the API origin.
    url: data?.relUrl ? `${BASE}${data.relUrl}` : '',
    // Server-side sidecar lookup of the artifact's published URL (if
    // any). Forwarded so the viewer shows the "Published" pill even
    // when opened from a chat bubble — those carry no publishedUrl on
    // the artifact object since they're built from streamed payloads.
    publishedUrl: data?.publishedUrl || '',
  };
}

export async function openArtifact(path) {
  return req('/artifacts/open', { method: 'POST', body: JSON.stringify({ path }) });
}

export async function revealArtifact(path) {
  return req('/artifacts/reveal', { method: 'POST', body: JSON.stringify({ path }) });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export async function fetchSettings() {
  try {
    return await req('/settings');
  } catch {
    return { ...MOCK_DATA.settings, configReady: false, configError: 'Anton backend is offline.' };
  }
}

export async function updateSettings(patch) {
  return req('/settings', { method: 'PUT', body: JSON.stringify(patch) });
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

// Fetch the real (unmasked) value of a stored API key — drives the eye
// icon "reveal" in Settings. The GET /settings endpoint returns "***"
// for stored keys; this endpoint returns the actual stored value so the
// user can verify which key is configured.
export async function revealSettingKey(name) {
  try {
    const res = await req(`/settings/reveal-key/${encodeURIComponent(name)}`);
    return res?.value || '';
  } catch {
    return '';
  }
}

export async function fetchIntegrations() {
  try {
    return await req('/integrations');
  } catch {
    return { items: MOCK_DATA.integrations };
  }
}

export async function startGoogleDriveAuth() {
  return req('/integrations/google-drive/oauth/start', { method: 'POST', body: JSON.stringify({}) });
}

export async function startGoogleCalendarAuth() {
  return req('/integrations/google-calendar/oauth/start', { method: 'POST', body: JSON.stringify({}) });
}

// ─── Dispatch (channels + wirings) ────────────────────────────────────────────
// Dispatch routes every channel to a single shared "Anton" agent group, ensured
// server-side — there are no agent-group management endpoints.
export async function fetchDispatchStatus() {
  try {
    return await req('/dispatch/status');
  } catch {
    return { ready: false, registered_channels: [], active_channels: [], agent_group_count: 0, wiring_count: 0 };
  }
}

export async function fetchDispatchChannels() {
  try {
    const data = await req('/dispatch/channels');
    return data.channels ?? [];
  } catch {
    return [];
  }
}

export async function fetchWirings() {
  try {
    const data = await req('/dispatch/wirings');
    return data.wirings ?? [];
  } catch {
    return [];
  }
}

export async function fetchMessagingGroups() {
  try {
    const data = await req('/dispatch/messaging-groups');
    return data.messaging_groups ?? [];
  } catch {
    return [];
  }
}

export async function createWiring(payload) {
  return req('/dispatch/wirings', { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteWiring(mgId, agId) {
  return req(`/dispatch/wirings/${encodeURIComponent(mgId)}/${encodeURIComponent(agId)}`, { method: 'DELETE' });
}

// Disconnect one channel — stops its live adapter, clears stored credentials
// (env vars + vault), and removes its wirings. Sticky across server restarts.
export async function disconnectChannel(channelType) {
  return req(`/dispatch/channels/${encodeURIComponent(channelType)}/disconnect`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Disconnect every channel — full dispatch reset (all adapters, credentials,
// and wirings). Sessions and message history are left intact.
export async function disconnectAllChannels() {
  return req('/dispatch/disconnect-all', { method: 'POST', body: JSON.stringify({}) });
}

// Re-initialize every channel adapter from current credentials — applies
// saved or cleared config live, no server restart. Returns active channels.
export async function reloadDispatch() {
  return req('/dispatch/reload', { method: 'POST', body: JSON.stringify({}) });
}

export async function startSlackOAuth(redirectUri) {
  const params = new URLSearchParams({ redirect_uri: redirectUri });
  return req(`/dispatch/slack/oauth/start?${params.toString()}`, { method: 'POST', body: JSON.stringify({}) });
}

export async function fetchSlackConfig() {
  try {
    return await req('/dispatch/slack/config');
  } catch {
    return {
      client_id_set: false,
      client_secret_set: false,
      signing_secret_set: false,
      app_token_set: false,
      install_ready: false,
      socket_mode_ready: false,
    };
  }
}

export async function saveSlackConfig({ clientId, clientSecret, signingSecret, appToken }) {
  const payload = {};
  if (clientId !== undefined)      payload.client_id      = clientId;
  if (clientSecret !== undefined)  payload.client_secret  = clientSecret;
  if (signingSecret !== undefined) payload.signing_secret = signingSecret;
  if (appToken !== undefined)      payload.app_token      = appToken;
  return req('/dispatch/slack/config', { method: 'PUT', body: JSON.stringify(payload) });
}

export async function fetchTelegramConfig() {
  try {
    return await req('/dispatch/telegram/config');
  } catch {
    return {
      bot_token_set: false,
      bot_username_set: false,
      webhook_url_set: false,
      install_ready: false,
      mode: 'long-poll',
    };
  }
}

export async function saveTelegramConfig({ botToken, botUsername, webhookUrl }) {
  const payload = {};
  if (botToken    !== undefined) payload.bot_token    = botToken;
  if (botUsername !== undefined) payload.bot_username = botUsername;
  if (webhookUrl  !== undefined) payload.webhook_url  = webhookUrl;
  return req('/dispatch/telegram/config', { method: 'PUT', body: JSON.stringify(payload) });
}

export async function fetchDiscordConfig() {
  try {
    return await req('/dispatch/discord/config');
  } catch {
    return {
      client_id_set: false,
      client_secret_set: false,
      bot_token_set: false,
      public_key_set: false,
      gateway_ready: false,
      interactions_ready: false,
      install_ready: false,
    };
  }
}

export async function saveDiscordConfig({ clientId, clientSecret, botToken, publicKey }) {
  const payload = {};
  if (clientId     !== undefined) payload.client_id     = clientId;
  if (clientSecret !== undefined) payload.client_secret = clientSecret;
  if (botToken     !== undefined) payload.bot_token     = botToken;
  if (publicKey    !== undefined) payload.public_key    = publicKey;
  return req('/dispatch/discord/config', { method: 'PUT', body: JSON.stringify(payload) });
}

export async function startDiscordInstall(redirectUri) {
  const params = new URLSearchParams({ redirect_uri: redirectUri });
  return req(`/dispatch/discord/oauth/install?${params.toString()}`, { method: 'POST', body: JSON.stringify({}) });
}

export async function fetchWhatsAppConfig() {
  try {
    return await req('/dispatch/whatsapp/config');
  } catch {
    return {
      phone_number_id_set: false,
      access_token_set: false,
      verify_token_set: false,
      app_secret_set: false,
      business_account_id_set: false,
      install_ready: false,
    };
  }
}

export async function saveWhatsAppConfig({ phoneNumberId, accessToken, verifyToken, appSecret, businessAccountId }) {
  const payload = {};
  if (phoneNumberId     !== undefined) payload.phone_number_id     = phoneNumberId;
  if (accessToken       !== undefined) payload.access_token        = accessToken;
  if (verifyToken       !== undefined) payload.verify_token        = verifyToken;
  if (appSecret         !== undefined) payload.app_secret          = appSecret;
  if (businessAccountId !== undefined) payload.business_account_id = businessAccountId;
  return req('/dispatch/whatsapp/config', { method: 'PUT', body: JSON.stringify(payload) });
}

export async function startGmailAuth() {
  return req('/integrations/gmail/oauth/start', { method: 'POST', body: JSON.stringify({}) });
}

// ─── Anton Utilities ────────────────────────────────────────────────────────
export async function fetchMemory(projectPath) {
  const suffix = projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : '';
  // Coalesced per project. ContextCard, ProjectCard, and the list
  // view's row-stats hook can all ask for the same project's memory
  // listing at the same moment; this collapses the duplicates.
  return dedupe(`memory${suffix}`, () => req(`/memory${suffix}`));
}

export async function saveMemory(payload) {
  return req('/memory', { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteMemory({ scope, relativePath, projectPath }) {
  const params = new URLSearchParams({ scope, relative_path: relativePath });
  if (projectPath) params.set('project_path', projectPath);
  return req(`/memory?${params.toString()}`, { method: 'DELETE' });
}

export async function fetchSkills() {
  return req('/skills');
}

export async function saveSkill(payload) {
  return req('/skills', { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteSkill(label) {
  return req(`/skills/${encodeURIComponent(label)}`, { method: 'DELETE' });
}

export async function fetchDatasources() {
  return req('/datasources');
}

export async function saveDatasource(payload) {
  return req('/datasources', { method: 'POST', body: JSON.stringify(payload) });
}

export async function validateDatasource(payload) {
  return req('/datasources/validate', { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteDatasource(engine, name) {
  return req(`/datasources/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Modify-flow read: returns the saved connection as
//   {
//     engine, name, createdAt, updatedAt,
//     secureKeys: string[],                  // names of secret fields
//     fields: { ... },                       // non-secret values verbatim,
//                                            // secret slots replaced with
//                                            // ANTON_VAULT_KEEP sentinel
//   }
// The renderer pre-fills the form with `fields`. On submit, any
// field still carrying the sentinel resolves server-side against
// the prior record (the modify merge — see anton-core's
// `resolve_modify_merge`). Empty string means "explicitly clear".
export async function fetchSavedConnection(engine, name) {
  return req(`/datasources/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`);
}

// Sentinel string used in the modify-flow round-trip. Mirrors the
// constant in `anton.core.datasources.data_vault.ANTON_VAULT_KEEP` —
// they MUST stay in sync. The form panel uses this to detect "user
// hasn't touched this secret field" on submit; any field whose
// value is still this exact string is sent back as-is and resolved
// server-side against the prior record.
export const ANTON_VAULT_KEEP = '__anton_vault_keep__';

// ─── Connector registry ─────────────────────────────────────────────
//
// Predefined JSON specs in server/connectors/. Three calls:
//   list()         → lightweight summaries for the picker UI
//   get(id)        → the full spec (literal-retrieval, no LLM)
//   match(query)   → ranked candidates for natural-language input
//
// The match endpoint runs a no-LLM cascade (exact id/alias →
// token-overlap) so most calls finish without a model round-trip.

export async function fetchConnectors() {
  try {
    const data = await req('/connectors');
    return Array.isArray(data?.connectors) ? data.connectors : [];
  } catch {
    return [];
  }
}

export async function fetchConnector(id) {
  return req(`/connectors/${encodeURIComponent(id)}`);
}

export async function matchConnector(query, maxCandidates = 3) {
  return req('/connectors/match', {
    method: 'POST',
    body: JSON.stringify({ query, max_candidates: maxCandidates }),
  });
}

// Save a connector connection through the JSON-declared field
// schema (bypasses Anton-core's built-in registry — needed for
// OAuth + service-account flows where the legacy email/password
// engine would reject the credential shape).
export async function saveConnector(connectorId, payload) {
  return req(`/connectors/${encodeURIComponent(connectorId)}/save`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export async function fetchPublishable() {
  return req('/publish');
}

// Submit a data-vault form and stream the cowork agent's response.
//
// Replaces the prior fire-and-forget POST. The agent endpoint:
//   1. stages the values into the vault keyed by submission_id
//   2. validates / probes the connection server-side
//   3. emits a Response-API-compatible SSE stream with text deltas,
//      a `data-vault-form-patch` block, and `response.completed` with
//      a status field
//
// We pipe those events through the same callbacks the chat stream
// uses, so the consumer (App.jsx) can treat the result as a fresh
// assistant turn — no separate render path needed.
//
// Field VALUES never round-trip through the response.
export function streamDataVaultSubmission({
  formId, conversationId, formSpec, values, skipped,
  onChunk, onProgress, onToolResult, onDone, onError, onEvent,
} = {}) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/datavault/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: formId,
          conversation_id: conversationId || null,
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

// Backwards-compatible non-streaming wrapper — kept so callers that
// just need to stage values without streaming back can still do so.
// (Currently unused by the form panel; might disappear in a cleanup.)
export async function submitDataVaultForm({ formId, conversationId, values, skipped, formSpec }) {
  // Fire the streaming endpoint but only consume the JSON body of
  // the response — useful for tests/probes that don't want SSE.
  const res = await fetch(`${BASE}/datavault/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form_id: formId,
      conversation_id: conversationId || null,
      values: values || {},
      skipped: skipped || [],
      form_spec: formSpec || null,
    }),
  });
  if (!res.ok) throw await responseError(res, `Form submit failed (${res.status})`);
  // Consume the stream and return a summary.
  const text = await res.text();
  return { status: 'streamed', body: text };
}

export async function publishArtifact(path) {
  return req('/publish', { method: 'POST', body: JSON.stringify({ path }) });
}

export async function fetchBrowseStatus() {
  return req('/browse/status');
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
  const res = await fetch(
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
  // Prefer the path-scoped route — the legacy `DELETE /attachments/{id}`
  // looked up a JSON state file the upload code never populates and
  // always 404'd. When the caller passes project + session, hit the
  // new endpoint that walks the on-disk directory directly.
  if (projectName && sessionId && id) {
    const enc = encodeURIComponent;
    return req(`/attachments/${enc(projectName)}/${enc(sessionId)}/${enc(id)}`, { method: 'DELETE' });
  }
  // Back-compat — kept so any older call site that hasn't migrated
  // still hits the original route (and gets the same 404 it always
  // did, surfacing the problem rather than failing silently).
  return req(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Absolute URL to the attachment's underlying file, served inline so
 * the browser's default handler (image / pdf / text preview) takes
 * over when the row is clicked. Works in both Electron and the web
 * SPA — `host.openExternal(url)` does the right thing for each. */
export function attachmentRawUrl(projectName, sessionId, attachmentId) {
  if (!projectName || !sessionId || !attachmentId) return null;
  const enc = encodeURIComponent;
  return `${BASE}/attachments/${enc(projectName)}/${enc(sessionId)}/${enc(attachmentId)}/raw`;
}

/** Promote a task upload to a project-level file. Returns
 * `{ ok, project_path, absolute_path }` on success. The client must
 * refresh BOTH the task uploads list and the project files list — the
 * file moves out of one and into the other on disk. */
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
    return await req('/pins');
  } catch {
    return { pins: [] };
  }
}

export async function pinTask(task) {
  return req('/pins', { method: 'POST', body: JSON.stringify({ item_type: 'task', item_id: task.id, title: task.title }) });
}

export async function unpinTask(id) {
  return req(`/pins/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Rename + delete + move are powered by the conversation patch/delete
// endpoints. The server's PATCH supports both `title` and `project`
// in one call; we expose them as separate helpers for clearer call
// sites.
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

// Delete one user→answer cycle (the question + the assistant
// response, including any internal tool_use/tool_result blocks
// anton generated during the turn). `turnIndex` is the 0-based
// displayable bubble index — same value used to look up events
// in the per-turn sidecar.
export async function deleteConversationTurn(id, turnIndex) {
  const res = await fetch(
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
  // Idempotent — if the server says "not found", treat that as
  // success. The conversation may have been removed by a previous
  // attempt or a concurrent client; either way the desired end state
  // ("gone from server") is achieved.
  const res = await fetch(BASE + `/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return { status: 'gone', id };
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch {}
    throw new Error(detail || `Delete failed (${res.status})`);
  }
  return res.json();
}

export async function moveConversation(id, projectName) {
  return req(`/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ project: projectName }),
  });
}

export async function recordTaskVisit(task, autoPin = false) {
  const params = new URLSearchParams({ auto_pin: autoPin ? 'true' : 'false' });
  if (task?.title) params.set('title', task.title);
  return req(`/pins/${encodeURIComponent(task.id)}/visit?${params.toString()}`, { method: 'POST' });
}

export async function fetchSchedules() {
  try {
    return await req('/schedules');
  } catch {
    return { schedules: [] };
  }
}

export async function createSchedule(payload) {
  return req('/schedules', { method: 'POST', body: JSON.stringify(payload) });
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
  // Returns { schedule_id, runs: [{ id, scheduleId, startedAt,
  // finishedAt, durationMs, status, error, sessionId, manual }] }
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
    { id: 't5', title: 'Create website copy for Anton CoWork', subtitle: '2 weeks ago', status: 'done', messages: [
      { role: 'user', content: 'Create website copy for Anton CoWork' },
      { role: 'assistant', content: 'Done — copy is in your Artifacts.' },
    ]},
    { id: 't6', title: 'Create MindsDB website copy positioning', subtitle: '3 weeks ago', status: 'done', messages: [] },
    { id: 't7', title: 'Redesign presentation slide from doc', subtitle: '3 weeks ago', status: 'idle', messages: [] },
    { id: 't8', title: 'Create operational plan with milestones', subtitle: '1 month ago', status: 'done', messages: [] },
  ],

  projects: [
    { id: 'p1', name: 'AI Fab launch', description: 'Hardware, infra, and brand for the AI Fab', taskCount: 14, fileCount: 23, updated: '2h ago', tint: 'rgba(31,156,176,0.12)', color: 'var(--primary-700)' },
    { id: 'p2', name: 'MindsDB website', description: 'Marketing site copy + positioning', taskCount: 9, fileCount: 41, updated: 'Yesterday', tint: 'rgba(72,190,227,0.14)', color: 'var(--ocean-700)' },
    { id: 'p3', name: 'CoWork brand', description: 'Brand and identity for the Anton CoWork app', taskCount: 6, fileCount: 12, updated: '3d ago', tint: 'rgba(120,186,172,0.18)', color: 'var(--sage-700)' },
    { id: 'p4', name: 'Operational ops', description: 'Internal ops, RIF, hiring plans', taskCount: 11, fileCount: 8, updated: '1w ago', tint: 'rgba(244,177,131,0.15)', color: '#B7522B' },
  ],

  artifacts: [
    { id: 'a1', title: 'RIF announcement — v3', kind: 'Document', updated: 'updated 4m ago', live: true, bg: 'linear-gradient(135deg, var(--stone-100), var(--surface-03))', snippet: "Team,\n\nAs we mentioned in last\nweek's all-hands, we are\nrestructuring our…" },
    { id: 'a2', title: 'Lightsail cost projection', kind: 'Spreadsheet', updated: 'updated 1h ago', live: true, bg: 'linear-gradient(135deg, var(--ocean-50), #fff)', snippet: 'instance | type   | $/mo\n--------+--------+-----\n  ai-01 | xlarge |  84\n  ai-02 | medium |  42' },
    { id: 'a3', title: 'CoWork landing — copy v2', kind: 'Document', updated: 'updated yesterday', live: false, bg: 'linear-gradient(135deg, var(--sage-50), #fff)', snippet: "A teammate that knows your\ncompany. Anton works in your\nprojects, with your data, on\nyour cadence." },
    { id: 'a4', title: 'AI Fab brand explorations', kind: 'Canvas', updated: 'updated 2d ago', live: false, bg: 'linear-gradient(135deg, #fff, var(--stone-150))', snippet: '◇ logomark draft 04\n◇ wordmark v2\n◇ palette — aqua x stone' },
  ],

  scheduled: [
    { id: 's1', title: 'Daily — pull GitHub PR digest', cadence: 'Every weekday at 9:00', nextRun: 'tomorrow 9:00', enabled: true },
    { id: 's2', title: 'Weekly — sales pipeline summary', cadence: 'Mondays at 8:30', nextRun: 'Mon 8:30', enabled: true },
    { id: 's3', title: 'Hourly — monitor Lightsail spend', cadence: 'Every hour', nextRun: 'in 24m', enabled: false },
  ],

  models: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: 'Balanced — fastest for daily work' },
    { id: 'claude-opus-4-7',   name: 'Claude Opus 4.7',   desc: 'Best for deep reasoning and long tasks' },
    { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  desc: 'Quickest, lightweight responses' },
  ],

  settings: {
    greeting: "Let's knock something off your list",
    tone: 'balanced',
    defaultModel: 'claude-sonnet-4-6',
    autoPin: true,
    showDots: true,
    showCounters: true,
    accentVariant: 'aqua',
    planningProvider: 'anthropic',
    planningModel: 'claude-sonnet-4-6',
    codingProvider: 'anthropic',
    codingModel: 'claude-haiku-4-5-20251001',
    memoryEnabled: true,
    memoryMode: 'autopilot',
    episodicMemory: true,
    proactiveDashboards: false,
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

  integrations: [
    {
      id: 'google_drive',
      title: 'Google Drive',
      engine: 'google_drive',
      status: 'needs_config',
      description: 'Connect your Google Drive account with Google sign-in so Anton can work with Drive files, Docs, and Sheets.',
      setupMode: 'browser_oauth',
      connectionCount: 0,
      connections: [],
      engineAvailable: true,
      oauth: {
        ready: false,
        configError: 'Configure ANTON_GOOGLE_CLIENT_ID and ANTON_GOOGLE_CLIENT_SECRET in ~/.anton/.env to enable Google Drive sign-in.',
        pending: false,
        lastSuccessAt: '',
        lastError: '',
        lastErrorAt: '',
        launchLabel: 'Connect Google Drive',
        redirectUri: 'http://127.0.0.1:8765/v1/integrations/google-drive/oauth/callback',
      },
      notes: [
        'Click Connect Google Drive to open Google sign-in in your browser.',
        'Anton stores the returned Google OAuth credentials in its local data vault under ~/.anton/data_vault/.',
        'Google Drive only shows as connected after the OAuth callback succeeds.',
      ],
    },
  ],
};
