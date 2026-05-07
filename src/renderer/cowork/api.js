// API client — talks to the FastAPI backend at /v1/*.
// Port matches antontron's server-process default (26866 = ANTON on T9
// keypad). Vite dev would proxy /v1 → backend; packaged Electron runs
// from file:// or app:// and must address the loopback server directly.

import { initialStreamState, reduceStream } from './lib/responseStreamAdapter';

const ANTON_SERVER_PORT = 26866;

const API_ORIGIN = (() => {
  if (typeof window === 'undefined') return '';
  const protocol = window.location?.protocol;
  return protocol === 'file:' || protocol === 'app:'
    ? `http://127.0.0.1:${ANTON_SERVER_PORT}`
    : '';
})();

const BASE = `${API_ORIGIN}/v1`;
const ROOT_BASE = `${API_ORIGIN}`;

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.detail || data?.message || '';
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
    pinned: false,
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

// Streams a /v1/responses request. Maps OpenAI-style typed events to the
// callback shape the rest of the app already speaks. `conversationId` is
// optional — omit it to start a new conversation; the caller learns the
// new id via the first onChunk/onProgress/onDone callback's second arg.
function _streamResponse(text, { conversationId, projectName, projectPath, model, attachmentIds = [], onChunk, onProgress, onToolResult, onDone, onError, onEvent } = {}) {
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

export function streamMessage(sessionId, text, opts = {}) {
  return _streamResponse(text, { ...opts, conversationId: sessionId });
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
// live at ANTON_PROJECT_INSTRUCTIONS_PATH (on disk: `.context/anton.md`).
// These helpers wrap routes/projects.py.

const enc = encodeURIComponent;

/** Relative path from project root for LLM instructions (API + listing). */
export const ANTON_PROJECT_INSTRUCTIONS_PATH = '.context/anton.md';

export async function readProjectFile(projectName, path) {
  // `path` may have slashes — encode each segment, not the whole
  // string (encodeURIComponent('a/b') → 'a%2Fb' which the FastAPI
  // route would treat as a single literal segment).
  const safe = path.split('/').map(enc).join('/');
  return req(`/projects/${enc(projectName)}/files/${safe}`);
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
export async function fetchArtifacts() {
  try {
    return await req('/artifacts');
  } catch {
    return [];
  }
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

// ─── Anton Utilities ────────────────────────────────────────────────────────
export async function fetchMemory(projectPath) {
  const suffix = projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : '';
  return req(`/memory${suffix}`);
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
export async function uploadAttachments(files, { projectPath, sessionId } = {}) {
  const form = new FormData();
  Array.from(files).forEach((file) => form.append('files', file));
  if (projectPath) form.append('project_path', projectPath);
  if (sessionId) form.append('session_id', sessionId);
  const res = await fetch(`${BASE}/attachments/upload`, { method: 'POST', body: form });
  if (!res.ok) throw await responseError(res, `Attachment upload failed (${res.status})`);
  return res.json();
}

export async function createSnippetAttachment(payload) {
  return req('/attachments/snippet', { method: 'POST', body: JSON.stringify(payload) });
}

export async function createUrlAttachment(payload) {
  return req('/attachments/url', { method: 'POST', body: JSON.stringify(payload) });
}

export async function fetchProjectFiles(projectPath, query = '') {
  const params = new URLSearchParams({ project_path: projectPath, q: query });
  return req(`/attachments/project-files?${params.toString()}`);
}

export async function attachProjectFile(payload) {
  return req('/attachments/project-file', { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteAttachment(id) {
  return req(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
