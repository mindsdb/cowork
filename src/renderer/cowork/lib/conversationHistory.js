// Pure conversation / stream-history helpers. They operate purely on their
// arguments plus module imports and `localStorage` — closing over nothing in
// component scope — so they live beside the other pure adapters
// (`responseStreamAdapter`, `settingsTransform`) and are unit-tested directly.
//
// Their side-effecting counterparts stay in App.jsx: `openStreamedForm`
// (dispatches to the data-vault store) and `loadSessionMessagesWithRetry`
// (async, hits the API) — the latter just calls `applySessionMessages` here.
import { initialStreamState, reduceStream } from './responseStreamAdapter';
import { isAntonConfigError, normalizeAntonError } from './antonErrors';

const THINKING_PLACEHOLDER = 'Thinking...';

export function stripStreaming(messages) {
  return messages.filter((m) => m.role !== '_streaming');
}

// Status values the stream reducer leaves behind for IN-FLIGHT step
// activity. A clean turn closes everything to 'completed' / 'done' /
// 'error' / 'cancelled'. Anything else is "this step was running
// when the stream died" — we'll mark them done on reload so the rail
// stops claiming work is still happening.
const RUNNING_STEP_STATUSES = new Set([
  'pending', 'thinking', 'streaming', 'in_progress', 'running',
]);

// Reconcile a task's stored streaming/running state against whether
// a real SSE stream is alive for it RIGHT NOW. Called when the user
// navigates into a task:
//   1. Drop `_streaming` / activity placeholders when not live.
//   2. Collapse in-progress steps to `completed` when not tailing.
export function reconcileTaskMessages(messages, isLive, isServerInFlight = false) {
  if (!Array.isArray(messages)) return messages;
  if (isLive) return messages; // legitimate in-flight (local), leave alone
  // If the server says this conversation's producer is still running,
  // we're about to (re)attach via tailInFlight — DON'T inject the
  // "things stopped before I wrapped up" continuation prompt. The
  // live stream will materialize within ~50ms via the reconnect
  // path; showing the stopped message first would be both wrong
  // AND flicker.
  //
  // Step-cleanup (RUNNING_STEP_STATUSES → completed) is also skipped
  // here: those steps may still be progressing under the live tail
  // and we don't want to prematurely flag them done.
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
  // Caller-supplied label so the new-task path can read "Creating
  // task…" while a reply uses the generic "Thinking…". Both the
  // activity placeholder (fallback render in ChatView) and the
  // `_streaming` stub (primary render via the existing streaming
  // branch) carry the same string, so whichever lands in the
  // viewport reads consistently.
  const label = opts.label || 'Thinking…';
  // Two rows:
  //   1. The activity placeholder — kept so any code path that
  //      consumes it (rail Progress card today, future surfaces) sees
  //      the "user just sent" signal.
  //   2. A `_streaming` stub — picked up by ChatView's existing
  //      streaming render block (`!streamingMsg.steps?.length &&
  //      !streamingMsg.content` branch), which renders an animated
  //      cursor + label inline below the user's message. Without
  //      this, the chat scroll is silent between send and the first
  //      SSE event — fine on a warm session (~sub-second) but
  //      painful on a brand-new task where anton's bootstrap can
  //      take 20-30s. The stub gets stripped + replaced by the real
  //      streaming row on the first `flushStreamingMessage` call,
  //      at which point `_placeholderLabel` is gone and the label
  //      naturally falls back to the default "Thinking…".
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
      // 'thinking' (not 'starting') so PhaseProgress treats the turn
      // as `isInFlight` and renders the Thinking phase row in the
      // rail — otherwise the card falls into its "Steps appear here
      // while Anton works" placeholder branch, which contradicts
      // the inline cursor in the chat scroll.
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

// ─── Per-turn step persistence ───────────────────────────────────────────
//
// Anton's history file (the canonical conversation record) only stores
// {role, content}. The streaming adapter builds richer step data —
// scratchpad cells, artifacts, reasoning timing — but those are dropped
// on persistence and would be lost on conversation reload, leaving the
// chat with no Thinking block, no inline artifact cards, and an empty
// Scratchpad modal.
//
// We sidecar the full step list in localStorage keyed by conversation
// id → assistant turn index. Persistence is local to this install
// (fine for a desktop app); promote to a server-side sidecar later if
// cross-device sync matters.
//
// Schema (per turn):
//   { steps: ThinkingStep[], startedAt: number }
//
// ThinkingStep shape mirrors `responseStreamAdapter`'s output, including
// the `_isScratchpad` / `_scratchpadTabId` markers the ScratchpadModal
// keys off so tabs reattach when the conversation is reopened.
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

// Walk a messages payload from the server and, for any assistant
// turn that carries an `events` array (the new sidecar), derive
// `steps`/`startedAt` via the live reducer. A terminal
// `response.failed` becomes a client-side error bubble after the
// partial assistant turn. Drops the raw `events` array.
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
    // Distinct from `status` — a failed tool/killed cell is still
    // status:'completed' (the lifecycle finished), with cellStatus
    // carrying the actual verdict ('error'/'timeout'). Without these two,
    // a failed step renders as a plain success after reload: `status`
    // alone survives, but the reducer's cellStatus:'error' (tool_call.end
    // with ok:false, or a killed scratchpad_done) and the measured
    // executionDurationMs both got silently dropped by this whitelist.
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
