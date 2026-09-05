// Conversation-history adapters; network retries and data-vault dispatch remain in App.jsx.
import { initialStreamState, reduceStream } from './responseStreamAdapter';
import { isAntonConfigError, normalizeAntonError } from './antonErrors';

const THINKING_PLACEHOLDER = 'Thinking...';

export function stripStreaming(messages) {
  return messages.filter((m) => m.role !== '_streaming');
}

// Mark abandoned in-flight statuses complete on reload so the rail stops claiming work is still
// running.
const RUNNING_STEP_STATUSES = new Set([
  'pending', 'thinking', 'streaming', 'in_progress', 'running',
]);

// Reconcile stored placeholders and in-progress steps against the currently live or reconnectable
// stream.
export function reconcileTaskMessages(messages, isLive, isServerInFlight = false) {
  if (!Array.isArray(messages)) return messages;
  if (isLive) return messages; // legitimate in-flight (local), leave alone
// A server-live conversation will reconnect through tailInFlight; do not show a stopped prompt or
// prematurely complete its steps.
  if (isServerInFlight) {
    // If the conversation is in-flight but has no visible content yet
    // (e.g. a scheduled task that just started), show a thinking
    // placeholder so the user sees activity instead of a blank chat.
    const hasContent = messages.length > 0 && messages.some(
      (m) => m && (m.role === 'assistant' || m.role === '_streaming'),
    );
    if (!hasContent) return withThinkingPlaceholder(messages, { label: 'Running task…' });
    return messages;
  }
  const cleaned = messages
    .filter((m) => m && m.role !== '_streaming' && m.role !== 'activity')
    .map((m) => {
      if (m.role !== 'assistant') return m;
      if (!Array.isArray(m.steps) || m.steps.length === 0) return m;
      let dirty = false;
      const nextSteps = m.steps.map((s) => {
        if (s && RUNNING_STEP_STATUSES.has(s.status)) {
          dirty = true;
          return { ...s, status: 'completed', completedAt: s.completedAt || Date.now() };
        }
        return s;
      });
      // Also shake out a top-level message-level streamStatus if any
      // (the live stream sets it to 'streaming' / 'tool' / etc.).
      const streamStatusFix = m.streamStatus && m.streamStatus !== 'done'
        ? { streamStatus: 'done' }
        : null;
      if (!dirty && !streamStatusFix) return m;
      return { ...m, ...(dirty ? { steps: nextSteps } : {}), ...(streamStatusFix || {}) };
    });

  return cleaned;
}

export function removeThinkingPlaceholder(messages) {
  return messages.filter((m) => !(m.role === 'activity' && m.placeholder));
}

export function withThinkingPlaceholder(messages, opts = {}) {
  // Use the same label for the activity placeholder and streaming stub so both render paths agree.
  const label = opts.label || 'Thinking…';
  // Keep both rows: rail consumers need the activity signal, while ChatView needs a streaming stub
  // before the first SSE event.
  // flushStreamingMessage replaces the stub once real output arrives.
  return [
    ...removeThinkingPlaceholder(stripStreaming(messages)),
    {
      role: 'activity',
      content: label,
      kind: 'placeholder',
      phase: 'reasoning',
      state: 'running',
      placeholder: true,
      _label: label,
    },
    {
      role: '_streaming',
      content: '',
      steps: [],
      startedAt: Date.now(),
      // PhaseProgress recognizes thinking as in-flight; starting would show an idle rail beside the
      // active chat cursor.
      streamStatus: 'thinking',
      _placeholderLabel: label,
    },
  ];
}

export function markActivityDone(messages) {
  return messages.map((m) => (
    m.role === 'activity' && m.state === 'running'
      ? { ...m, state: 'done' }
      : m
  ));
}

export function humanizeToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function describeActivity(event, agentName = 'Anton') {
  if (event?.type === 'tool_result') {
    const action = humanizeToken(event.action || 'used');
    const name = humanizeToken(event.name || 'tool');
    return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${name}`.trim();
  }

  const message = humanizeToken(event?.message);
  if (message) return message;

  const phase = humanizeToken(event?.phase);
  const normalizedPhase = phase.toLowerCase();
  if (normalizedPhase === 'reasoning') return THINKING_PLACEHOLDER;
  if (normalizedPhase === 'reasoning done') return 'Finished reasoning';
  if (normalizedPhase === 'context') return 'Updated context';

  return phase ? `${agentName} is ${phase}` : `${agentName} is working`;
}

// Cache richer step data locally by conversation id and assistant-turn index when server history
// lacks it.
// Each entry is {steps: ThinkingStep[], startedAt: number}; preserve scratchpad markers for tab
// reattachment.
// This cache is install-local; newer server event logs are hydrated separately.
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

// One-time migration from the old artifact-only sidecar. Each entry
// was an array of artifact-shape steps; promote it to the new shape.
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

// Replay the server-persisted event log for one assistant turn
// through the same reducer the live stream uses. The resulting
// `steps` and `startedAt` are identical to what the client would
// have built during a fresh stream — no parity drift.
export function reduceServerEvents(events, fallbackStartedAt) {
  if (!Array.isArray(events) || events.length === 0) return null;
  let state = initialStreamState();
  for (const ev of events) {
    try { state = reduceStream(state, ev, Date.now, { replay: true }); } catch {}
  }
  return {
    steps: state.steps || [],
    startedAt: state.startedAt || fallbackStartedAt || null,
    // 'done' once the persisted events carried response.completed,
    // 'error' on response.failed — the authoritative "this turn
    // finished" signal from the detached stream buffer.
    status: state.status,
  };
}

export function failedEventMeta(events) {
  if (!Array.isArray(events)) return null;
  const ev = [...events].reverse().find((e) => e?.type === 'response.failed');
  if (!ev) return null;
  return {
    code: ev.code || null,
    message: ev.error || ev.message || '',
    reconnectable: ev.reconnectable ?? null,
    providerLabel: ev.provider_label ?? null,
    // model-403 (model_access_denied / model_disabled): which model the
    // gateway rejected, so the card can name it. `failedModel` locally —
    // "model" is too overloaded in message objects.
    failedModel: ev.model ?? null,
    // rate_limited: the gateway's own Retry-After, in seconds, so the card can
    // time-gate its Retry. Null when the gateway sent no hint — the
    // card then offers an ungated Retry rather than inventing an interval.
    retryAfter: typeof ev.retry_after === 'number' ? ev.retry_after : null,
    // included_allowance_exhausted: when the free grant refreshes, as the
    // gate's opaque ISO string. Formatted at render time — the server
    // deliberately doesn't parse it, since only the client knows the
    // viewer's timezone.
    resetAt: typeof ev.reset_at === 'string' ? ev.reset_at : null,
    // Absolute instant to gate Retry against. The message's own created_at
    // is NOT a substitute: the server serialises it offset-less, so JS reads
    // it as local time — the gate would last hours west of UTC and no-op east
    // of it, invisible to a TZ=UTC suite.
    retryAt: typeof ev.retry_at === 'string' ? ev.retry_at : null,
    // The remote turn's own correlation id (cowork-server), present on every
    // remote-backend failure regardless of code — the one thing a generic
    // anton_error bubble can still offer for a support lookup.
    requestId: typeof ev.request_id === 'string' ? ev.request_id : null,
  };
}

// Hydrate saved events through the live reducer and discard raw events.
// A terminal failure becomes an error bubble after any partial assistant output.
export function hydrateMessagesFromServerEvents(messages) {
  if (!Array.isArray(messages)) return messages;
  const out = [];
  for (const m of messages) {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.events) || m.events.length === 0) {
      out.push(m);
      continue;
    }
    const reduced = reduceServerEvents(m.events, m.startedAt);
    const { events: _drop, ...rest } = m;
    if (!reduced) {
      out.push(rest);
      continue;
    }
    const turnComplete = reduced.status === 'done' || reduced.status === 'error';
    const completeFlag = turnComplete ? { _turnComplete: true } : {};
    out.push({
      ...rest,
      ...completeFlag,
      ...(reduced.steps.length > 0
        ? { steps: reduced.steps, startedAt: rest.startedAt || reduced.startedAt }
        : {}),
    });
    if (reduced.status === 'error') {
      const failed = failedEventMeta(m.events);
      const code = failed?.code || null;
      const errText = failed?.message || 'An unexpected error occurred.';
      if (isAntonConfigError(errText, { code })) {
        out.push({ role: 'provider_required' });
      } else {
        out.push({
          role: 'error',
          content: normalizeAntonError(errText, { code }),
          code,
          reconnectable: failed?.reconnectable ?? null,
          providerLabel: failed?.providerLabel ?? null,
          failedModel: failed?.failedModel ?? null,
          retryAfter: failed?.retryAfter ?? null,
          resetAt: failed?.resetAt ?? null,
          retryAt: failed?.retryAt ?? null,
          requestId: failed?.requestId ?? null,
        });
      }
    }
  }
  return out;
}

export function applySessionMessages(
  cid,
  rawMessages,
  { isLive = false, isServerInFlight = false, skipLocalSidecar = false } = {},
) {
  const hydrated = hydrateMessagesFromServerEvents(rawMessages);
  const merged = skipLocalSidecar ? hydrated : mergeConvTurns(cid, hydrated);
  return reconcileTaskMessages(merged, isLive, isServerInFlight);
}

// Persist the full step set for one assistant turn so reload restores
// the Thinking block, scratchpad tabs, and inline artifact cards.
// `turnIndex` is the 0-based position of this assistant message among
// all assistant messages in the conversation.
export function persistTurnState(cid, turnIndex, steps, startedAt) {
  if (!cid || !Array.isArray(steps) || steps.length === 0) return;
  const map = readConvTurns(cid) || {};
  // Strip any non-serialisable fields (refs, functions). The step
  // shape is plain data otherwise.
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
    // Lifecycle status can be completed even when execution failed; persist cellStatus and duration
    // to retain that verdict after reload.
    cellStatus: s.cellStatus || null,
    executionDurationMs: s.executionDurationMs ?? null,
    data: s.data || null,
    output: typeof s.output === 'string' ? s.output : null,
    result: s.result || null,
    stderr: s.stderr || null,
    _isScratchpad: !!s._isScratchpad,
    _isToolCall: !!s._isToolCall,
    _scratchpadTabId: s._scratchpadTabId || null,
  }));
  map[turnIndex] = { steps: sanitized, startedAt: startedAt ?? null };
  writeConvTurns(cid, map);
}

// Merge persisted step + timing data onto assistant messages by turn
// index. Idempotent — if a message already has steps from a fresh
// stream we don't overwrite (the live data is more accurate).
export function mergeConvTurns(cid, messages) {
  if (!cid || !messages) return messages;
  migrateLegacyArtifacts(cid);
  const map = readConvTurns(cid);
  if (!map) return messages;
  let assistantIdx = 0;
  return messages.map((m) => {
    if (m.role !== 'assistant') return m;
    if (m._turnComplete) return m;
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

export function appendActivity(messages, event) {
  const content = describeActivity(event);
  const cleaned = removeThinkingPlaceholder(messages);
  const previous = cleaned[cleaned.length - 1];
  if (previous?.role === 'activity' && previous.content === content) {
    return [...cleaned.slice(0, -1), { ...previous, state: 'running' }];
  }
  return [
    ...cleaned,
    {
      role: 'activity',
      content,
      kind: event?.type || 'progress',
      phase: event?.phase || null,
      state: 'running',
    },
  ];
}
