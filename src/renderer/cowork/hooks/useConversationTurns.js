// Per-turn step persistence — localStorage sidecar for ThinkingStep data.
//
// Anton's history file only stores {role, content}. The streaming adapter
// builds richer step data (scratchpad cells, artifacts, reasoning timing)
// that would be lost on reload. We sidecar the full step list in
// localStorage keyed by conversation id → assistant turn index.

import { initialStreamState, reduceStream } from '../lib/responseStreamAdapter';

const CONV_TURNS_KEY = (cid) => `anton:conv-turns:${cid}`;
const LEGACY_ARTIFACTS_KEY = (cid) => `anton:conv-artifacts:${cid}`;

export function readConvTurns(cid) {
  if (!cid) return null;
  try {
    const raw = localStorage.getItem(CONV_TURNS_KEY(cid));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function writeConvTurns(cid, data) {
  if (!cid) return;
  try { localStorage.setItem(CONV_TURNS_KEY(cid), JSON.stringify(data)); }
  catch {} // private mode / quota — fail silently
}

// One-time migration from the old artifact-only sidecar.
export function migrateLegacyArtifacts(cid) {
  if (!cid) return;
  try {
    const legacy = localStorage.getItem(LEGACY_ARTIFACTS_KEY(cid));
    if (!legacy) return;
    const map = JSON.parse(legacy);
    if (!map || typeof map !== 'object') return;
    const next = readConvTurns(cid) || {};
    for (const [idx, arts] of Object.entries(map)) {
      if (!Array.isArray(arts) || arts.length === 0) continue;
      const existing = next[idx]?.steps || [];
      next[idx] = { steps: [...existing, ...arts], startedAt: next[idx]?.startedAt || null };
    }
    writeConvTurns(cid, next);
    localStorage.removeItem(LEGACY_ARTIFACTS_KEY(cid));
  } catch {}
}

// Replay server-persisted event log through the same reducer the
// live stream uses — identical steps to what the client would have
// built during a fresh stream.
export function reduceServerEvents(events, fallbackStartedAt) {
  if (!Array.isArray(events) || events.length === 0) return null;
  let state = initialStreamState();
  for (const ev of events) {
    try { state = reduceStream(state, ev); } catch {}
  }
  return {
    steps: state.steps || [],
    startedAt: state.startedAt || fallbackStartedAt || null,
  };
}

// Walk messages from the server and derive steps/startedAt from
// any assistant turn that carries an `events` array.
export function hydrateMessagesFromServerEvents(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const events = m.events;
    if (!Array.isArray(events) || events.length === 0) return m;
    const reduced = reduceServerEvents(events, m.startedAt);
    const { events: _drop, ...rest } = m;
    if (!reduced || reduced.steps.length === 0) return rest;
    return {
      ...rest,
      steps: reduced.steps,
      startedAt: rest.startedAt || reduced.startedAt,
    };
  });
}

// Persist the full step set for one assistant turn.
export function persistTurnState(cid, turnIndex, steps, startedAt) {
  if (!cid || !Array.isArray(steps) || steps.length === 0) return;
  const map = readConvTurns(cid) || {};
  const sanitized = steps.map((s) => ({
    id: s.id,
    label: s.label || null,
    badge: s.badge || null,
    icon: s.icon || null,
    status: s.status || 'completed',
    startedAt: s.startedAt ?? null,
    completedAt: s.completedAt ?? null,
    reasoningStartedAt: s.reasoningStartedAt ?? null,
    executionStartedAt: s.executionStartedAt ?? null,
    executionCompletedAt: s.executionCompletedAt ?? null,
    data: s.data || null,
    output: typeof s.output === 'string' ? s.output : null,
    result: s.result || null,
    stderr: s.stderr || null,
    _isScratchpad: !!s._isScratchpad,
    _scratchpadTabId: s._scratchpadTabId || null,
  }));
  map[turnIndex] = { steps: sanitized, startedAt: startedAt ?? null };
  writeConvTurns(cid, map);
}

// Merge persisted step + timing data onto assistant messages.
// Idempotent — if a message already has steps from a fresh stream
// we don't overwrite.
export function mergeConvTurns(cid, messages) {
  if (!cid || !messages) return messages;
  migrateLegacyArtifacts(cid);
  const map = readConvTurns(cid);
  if (!map) return messages;
  let assistantIdx = 0;
  return messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const saved = map[assistantIdx];
    assistantIdx += 1;
    if (!saved || !Array.isArray(saved.steps) || saved.steps.length === 0) return m;
    const hasLiveSteps = Array.isArray(m.steps) && m.steps.length > 0;
    if (hasLiveSteps) return m;
    return {
      ...m,
      steps: saved.steps,
      startedAt: m.startedAt || saved.startedAt || null,
    };
  });
}

// Smart merge: take server tasks (authoritative for title/project/status)
// but preserve local messages for tasks that are mid-stream or have
// unsaved content.
export function mergeTasksFromServer(serverTasks, localTasks) {
  const local = Array.isArray(localTasks) ? localTasks : [];
  if (!Array.isArray(serverTasks)) return local;
  const localById = new Map(local.map((t) => [t.id, t]));
  const merged = serverTasks.map((server) => {
    const l = localById.get(server.id);
    if (!l) return server;
    const lMessages = Array.isArray(l.messages) ? l.messages : [];
    const isStreaming = lMessages.some((m) => m.role === '_streaming');
    const hasLocalContent = lMessages.length > 0;
    if (!isStreaming && !hasLocalContent) return server;
    return {
      ...server,
      messages: lMessages,
      status: l.status || server.status,
      attachments: lMessages.length && Array.isArray(l.attachments) && l.attachments.length
        ? l.attachments
        : server.attachments,
    };
  });
  const serverIds = new Set(serverTasks.map((t) => t.id));
  for (const t of local) {
    if (!serverIds.has(t.id)) merged.unshift(t);
  }
  return merged;
}
