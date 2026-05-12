// Anton /v1/responses → ThinkingStep adapter.
//
// Anton's SSE stream emits one of three top-level event types:
//
//   response.created            — initial; carries response.id + conversation_id
//   response.in_progress        — wraps everything during work; the
//                                 actual sub-event is in `thought_role`:
//                                   thought.scratchpad.start
//                                   thought.scratchpad.end       (cell input)
//                                   thought.progress             (phase markers)
//                                   thought.scratchpad.result    (cell output)
//   response.output_text.delta  — body text streaming, `delta` field
//   response.completed | failed — terminal
//
// We collapse each scratchpad cell (start → end → progress → result) into
// a single ThinkingStep. progress.publish_or_preview produces a separate
// "Artifact" step from the JSON in the *following* progress event.
//
// Usage:
//
//   let state = initialStreamState();
//   for await (const event of stream) {
//     state = reduceStream(state, event);
//   }
//
// The reducer is pure — same input = same output, no side effects, no
// time reads. Callers pass `now` (defaults to Date.now) so tests can
// inject a clock.

export function initialStreamState() {
  return {
    responseId: null,
    conversationId: null,
    /** 'pending' | 'thinking' | 'streaming' | 'done' | 'error' */
    status: 'pending',
    startedAt: null,
    /** ThinkingStep[] in order */
    steps: [],
    /** Streaming/finished body text (markdown). */
    bodyText: '',
    /** Set when we've seen 'publish_or_preview' and expect the next
     *  progress content to be the artifact JSON payload. */
    awaitingArtifactPayload: false,
    /** Surfaced for diagnostics if a failure event arrives. */
    error: null,
  };
}

/** Replace (immutably) the trailing scratchpad step regardless of its
 *  status. The .result event arrives *after* scratchpad_done in some
 *  flows, so requiring in_progress here would silently drop the output.
 *
 *  Use this only as a fallback. When the upstream event carries a
 *  `tool_use_id`, prefer `patchScratchpadStepById` — multi-cell turns
 *  (LLM emits start/end for cells A,B,C upfront then anton dispatches
 *  them sequentially) need result events correlated to their source by
 *  id, otherwise A's result patches step C and the cells appear mixed.
 */
function patchLastScratchpadStep(steps, patch) {
  if (steps.length === 0) return steps;
  const idx = steps.length - 1;
  const last = steps[idx];
  if (!last._isScratchpad) return steps;
  const next = steps.slice();
  next[idx] = { ...last, ...patch };
  return next;
}

/** Patch the scratchpad step whose `_toolUseId` matches the given id.
 *  Returns the original list if no match. Used when the upstream
 *  event carries an explicit tool_use_id (modern server) so multi-
 *  cell turns no longer cross-attribute output between cells. */
function patchScratchpadStepById(steps, toolUseId, patch) {
  if (!toolUseId) return null;
  const idx = steps.findIndex(
    (s) => s && s._isScratchpad && s._toolUseId === toolUseId
  );
  if (idx === -1) return null;
  const next = steps.slice();
  next[idx] = { ...steps[idx], ...patch };
  return next;
}

/** Same but only acts on an in-progress scratchpad — used by close
 *  signals (response.completed/failed) to flip a still-open trailing
 *  step to completed without overwriting output later. */
function closeOpenScratchpadStep(steps, completedAt) {
  if (steps.length === 0) return steps;
  const idx = steps.length - 1;
  const last = steps[idx];
  if (!last._isScratchpad || last.status !== 'in_progress') return steps;
  const next = steps.slice();
  next[idx] = { ...last, status: 'completed', completedAt };
  return next;
}

function patchLastGenericStep(steps, predicate, patch) {
  for (let idx = steps.length - 1; idx >= 0; idx -= 1) {
    const step = steps[idx];
    if (!step?._isGenericProgress) continue;
    if (!predicate(step)) continue;
    const next = steps.slice();
    next[idx] = { ...step, ...patch };
    return next;
  }
  return null;
}

function addArtifactStep(state, payload, eventTs) {
  if (!payload || typeof payload !== 'object') return state;
  if (!payload.file_path && !payload.path && !payload.title && !payload.name) return state;
  const id = `artifact-${state.steps.length + 1}`;
  const title = payload.title || payload.name || payload.file_path || payload.path || 'Artifact';
  const step = {
    id,
    label: title,
    badge: 'Artifact',
    icon: 'sparkle',
    status: 'completed',
    startedAt: eventTs,
    completedAt: eventTs,
    data: payload,
    output: null,
    result: null,
    _isScratchpad: false,
    _isGenericProgress: false,
    _scratchpadTabId: null,
  };
  return {
    ...state,
    awaitingArtifactPayload: false,
    steps: [...state.steps, step],
  };
}

function progressMessage(event) {
  const message = event.message ?? event.content ?? '';
  return typeof message === 'string' ? message.trim() : '';
}

function safeJsonParse(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Extract a single string-typed field from a possibly-truncated JSON
 *  blob. The server clips `content` at ~2KB, so JSON.parse fails for
 *  long scratchpad cells; we still want the leading metadata. */
function extractJsonString(text, field) {
  if (typeof text !== 'string') return null;
  // Match "field": "<chars-with-escapes-up-to-next-unescaped-quote>"
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = text.match(re);
  if (!m) return null;
  // Unescape standard JSON escapes.
  try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; }
}

/** Extract a top-level field from a possibly-truncated JSON blob.
 *  Falls back to a regex pull when full parse fails. */
function bestEffortField(text, field) {
  const parsed = safeJsonParse(text);
  if (parsed && typeof parsed[field] === 'string') return parsed[field];
  if (parsed && parsed[field] != null) return parsed[field];
  return extractJsonString(text, field);
}

/**
 * Reduce one parsed SSE event onto the running state.
 *
 * @param {object} state    — previous state (treat as immutable)
 * @param {object} event    — { type, ...data } where data is the parsed JSON
 *                            from the SSE `data:` line
 * @param {() => number} [now] — clock injection for tests
 * @returns {object} new state
 */
export function reduceStream(state, event, now = Date.now) {
  if (!event || typeof event !== 'object') return state;
  const type = event.type;

  // Wall-clock timestamp the server stamped on this event. Live
  // streams: equals (≈) Date.now() at arrival. Historical replays:
  // the original moment the event was yielded. Without this, replay
  // collapses every `now()` to the same JS-tick value and reasoning
  // / execution durations all read as 0ms. Falls back to the live
  // clock when an event lacks `at_ms` (older persisted streams).
  const eventTs = (typeof event.at_ms === 'number' && Number.isFinite(event.at_ms))
    ? event.at_ms
    : now();

  // ── Lifecycle ─────────────────────────────────────────────────────
  if (type === 'response.created') {
    return {
      ...state,
      responseId: event.response?.id ?? state.responseId,
      conversationId: event.conversation_id ?? state.conversationId,
      startedAt: state.startedAt ?? now(),
      status: 'thinking',
    };
  }

  if (type === 'response.completed') {
    return { ...state, steps: closeOpenScratchpadStep(state.steps, now()), status: 'done' };
  }

  if (type === 'response.failed') {
    return {
      ...state,
      steps: closeOpenScratchpadStep(state.steps, now()),
      status: 'error',
      error: event.error || event.message || 'Response failed',
    };
  }

  if (type === 'response.output_text.delta') {
    const delta = typeof event.delta === 'string' ? event.delta : '';
    if (!delta) return state;
    return { ...state, status: 'streaming', bodyText: state.bodyText + delta };
  }

  // ── thought.* sub-events live under response.in_progress ──────────
  if (type !== 'response.in_progress') return state;

  const role = event.thought_role;

  // New scratchpad cell starts. We push a placeholder step now so the
  // UI sees activity even before the .end event delivers the input.
  // Reasoning starts here — it's the time anton spends deciding *what*
  // code to run, before the runtime actually executes anything.
  // `tool_use_id` (when the server includes it) is captured on the
  // step so subsequent end / progress / result events can be
  // correlated to THIS specific cell. Without that correlation,
  // multi-cell turns where the LLM queues several scratchpad calls
  // before any of them runs would patch the wrong step on result.
  if (role === 'thought.scratchpad.start') {
    const id = `step-${state.steps.length + 1}`;
    const step = {
      id,
      label: 'Running code',
      badge: 'Script',
      icon: 'code',
      status: 'in_progress',
      startedAt: eventTs,
      completedAt: null,
      reasoningStartedAt: eventTs,
      executionStartedAt: null,
      executionCompletedAt: null,
      // Server-measured execution duration (ms). Set when the
      // `scratchpad_done` progress event arrives carrying its
      // `eta_seconds` field — that's the actual elapsed time
      // anton's runtime reports, which is more accurate than
      // diffing event arrival timestamps.
      executionDurationMs: null,
      data: null,
      output: null,
      result: null,
      _isScratchpad: true,
      _scratchpadTabId: null,
      _toolUseId: event.tool_use_id || null,
    };
    return { ...state, steps: [...state.steps, step] };
  }

  // Scratchpad input — the JSON contains action, name, code,
  // one_line_description, etc. Use one_line_description as the visible
  // label and `name` as the tab id so multiple cells under the same
  // scratchpad name group together.
  if (role === 'thought.scratchpad.end') {
    const parsed = safeJsonParse(event.content);
    const oneLiner = parsed?.one_line_description ?? extractJsonString(event.content, 'one_line_description');
    const name     = parsed?.name                  ?? extractJsonString(event.content, 'name');
    const code     = parsed?.code                  ?? extractJsonString(event.content, 'code');
    if (!oneLiner && !name && !code) return state;
    const toolUseId = event.tool_use_id || null;
    // Find the step the .start event created for this id. Fall back
    // to the trailing scratchpad step for legacy/replayed streams
    // that don't carry tool_use_id.
    const target = toolUseId
      ? state.steps.find((s) => s._isScratchpad && s._toolUseId === toolUseId)
      : state.steps[state.steps.length - 1];
    const executionStartedAt = target?._isScratchpad
      ? (target.executionStartedAt || eventTs)
      : eventTs;
    const patch = {
      label: oneLiner || name || 'Running code',
      data: parsed || { one_line_description: oneLiner, name, code, _truncated: true },
      _scratchpadTabId: name || null,
      executionStartedAt,
    };
    const byId = patchScratchpadStepById(state.steps, toolUseId, patch);
    return { ...state, steps: byId || patchLastScratchpadStep(state.steps, patch) };
  }

  // Scratchpad output — JSON of { code, stdout, stderr, ... }. The
  // result event is the canonical "this cell finished" signal.
  // Correlated to its step by tool_use_id; falls back to "last
  // scratchpad" only for legacy events that lack the id.
  if (role === 'thought.scratchpad.result') {
    const stdout = bestEffortField(event.content, 'stdout');
    const stderr = bestEffortField(event.content, 'stderr');
    const parsed = safeJsonParse(event.content);
    const toolUseId = event.tool_use_id || null;
    const target = toolUseId
      ? state.steps.find((s) => s._isScratchpad && s._toolUseId === toolUseId)
      : state.steps[state.steps.length - 1];
    const executionCompletedAt = target?._isScratchpad
      ? (target.executionCompletedAt || eventTs)
      : eventTs;
    const patch = {
      output: typeof stdout === 'string' ? stdout : null,
      result: parsed || { stdout, stderr, _truncated: true },
      status: 'completed',
      completedAt: eventTs,
      executionCompletedAt,
      ...(typeof stderr === 'string' && stderr ? { stderr } : null),
    };
    const byId = patchScratchpadStepById(state.steps, toolUseId, patch);
    return { ...state, steps: byId || patchLastScratchpadStep(state.steps, patch) };
  }

  // Progress markers
  if (role === 'thought.progress') {
    const phase = event.phase;
    const content = event.content;
    const progressStatus = event.progress_status;

    // Hermes emits Cowork-compatible generic progress events instead
    // of Anton scratchpad cells. Artifact events carry their payload
    // directly on the event, or as JSON in `content`.
    if (phase === 'artifact') {
      const payload = (event.artifact && typeof event.artifact === 'object')
        ? event.artifact
        : safeJsonParse(content);
      return addArtifactStep(state, payload, eventTs);
    }

    // Cell finished — flip the trailing in-progress scratchpad to
    // completed if the .result hasn't arrived yet. (When .result does
    // come in, it'll carry the same status flip plus the output.)
    // Either way, this is when execution wraps.
    if (phase === 'scratchpad_done') {
      const toolUseId = event.tool_use_id || null;
      // Server-measured elapsed for this cell. anton sets it from
      // `time.monotonic()` deltas on the actual `pad.execute_streaming`
      // run, so it's the canonical execution duration we should
      // display — independent of stream / replay timing.
      const etaSeconds = (typeof event.eta_seconds === 'number'
        && Number.isFinite(event.eta_seconds))
        ? event.eta_seconds
        : null;
      const executionDurationMs = etaSeconds != null
        ? Math.max(0, Math.round(etaSeconds * 1000))
        : null;

      // Status flip: when the event carries a tool_use_id, find the
      // exact step by id and close ONLY that one. Otherwise fall
      // back to the trailing in-progress scratchpad (legacy stream).
      let stepsClosed;
      if (toolUseId) {
        const idx = state.steps.findIndex(
          (s) => s && s._isScratchpad && s._toolUseId === toolUseId,
        );
        if (idx !== -1 && state.steps[idx].status === 'in_progress') {
          stepsClosed = state.steps.slice();
          stepsClosed[idx] = { ...state.steps[idx], status: 'completed', completedAt: eventTs };
        } else {
          stepsClosed = state.steps;
        }
      } else {
        stepsClosed = closeOpenScratchpadStep(state.steps, eventTs);
      }
      const patch = {
        executionCompletedAt: eventTs,
        ...(executionDurationMs != null ? { executionDurationMs } : null),
      };
      const byId = patchScratchpadStepById(stepsClosed, toolUseId, patch);
      const stepsTimed = byId || patchLastScratchpadStep(stepsClosed, patch);
      return { ...state, steps: stepsTimed };
    }

    // Cell starting — already marked in_progress in .start, but if
    // somehow we missed .start (out-of-order), upsert a step now.
    // Either way, mark execution start (reasoning is over). When the
    // event carries a tool_use_id, target the matching step
    // explicitly so multi-cell turns don't time the wrong step.
    if (phase === 'scratchpad_start') {
      const toolUseId = event.tool_use_id || null;
      const patch = { executionStartedAt: eventTs };
      if (toolUseId) {
        const byId = patchScratchpadStepById(state.steps, toolUseId, patch);
        if (byId) return { ...state, steps: byId };
        // No step yet for this id — seed one and re-apply.
        const seeded = reduceStream(state, {
          type: 'response.in_progress',
          thought_role: 'thought.scratchpad.start',
          tool_use_id: toolUseId,
          at_ms: eventTs,
        }, now);
        const seededById = patchScratchpadStepById(seeded.steps, toolUseId, patch);
        return { ...seeded, steps: seededById || seeded.steps };
      }
      // Legacy / no id — preserve previous behaviour.
      const last = state.steps[state.steps.length - 1];
      if (!last || last.status !== 'in_progress') {
        const seeded = reduceStream(state, {
          type: 'response.in_progress',
          thought_role: 'thought.scratchpad.start',
          at_ms: eventTs,
        }, now);
        return { ...seeded, steps: patchLastScratchpadStep(seeded.steps, patch) };
      }
      return { ...state, steps: patchLastScratchpadStep(state.steps, patch) };
    }

    // 'publish_or_preview' is a two-event sequence — this one is just
    // the marker, the *next* progress event carries the JSON payload.
    if (content === 'publish_or_preview') {
      return { ...state, awaitingArtifactPayload: true };
    }

    // If we just saw the marker and this event has JSON content,
    // unpack it as an Artifact step.
    if (state.awaitingArtifactPayload && typeof content === 'string') {
      const payload = safeJsonParse(content);
      if (payload && (payload.file_path || payload.path || payload.title || payload.name)) {
        return addArtifactStep(state, payload, eventTs);
      }
      // Wasn't JSON after all — clear the flag and ignore.
      return { ...state, awaitingArtifactPayload: false };
    }

    if (phase === 'tool') {
      const toolName = String(event.tool_name || event.tool || 'tool');
      const message = progressMessage(event);
      const label = message || toolName;
      const failed = progressStatus === 'failed' || Boolean(event.error);
      const completed = failed || progressStatus === 'completed' || progressStatus === 'done';
      if (!completed) {
        const step = {
          id: `progress-${state.steps.length + 1}`,
          label,
          badge: 'Tool',
          icon: 'sparkle',
          status: 'in_progress',
          startedAt: eventTs,
          completedAt: null,
          data: {
            phase,
            progress_status: progressStatus || 'started',
            tool_name: toolName,
            message,
          },
          output: null,
          result: null,
          _isScratchpad: false,
          _isGenericProgress: true,
          _progressPhase: phase,
          _toolName: toolName,
        };
        return { ...state, steps: [...state.steps, step] };
      }

      const patch = {
        label,
        status: failed ? 'failed' : 'completed',
        completedAt: eventTs,
        data: {
          phase,
          progress_status: failed ? 'failed' : 'completed',
          tool_name: toolName,
          message,
          error: event.error || null,
        },
      };
      const patched = patchLastGenericStep(
        state.steps,
        (step) => step._progressPhase === 'tool'
          && step._toolName === toolName
          && step.status === 'in_progress',
        patch,
      );
      if (patched) return { ...state, steps: patched };
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            id: `progress-${state.steps.length + 1}`,
            badge: 'Tool',
            icon: 'sparkle',
            startedAt: eventTs,
            output: null,
            result: null,
            _isScratchpad: false,
            _isGenericProgress: true,
            _progressPhase: phase,
            _toolName: toolName,
            ...patch,
          },
        ],
      };
    }

    if (phase === 'reasoning') {
      const message = progressMessage(event);
      if (!message) return state;
      const step = {
        id: `progress-${state.steps.length + 1}`,
        label: 'Reasoning',
        badge: 'Thought',
        icon: 'sparkle',
        status: 'completed',
        startedAt: eventTs,
        completedAt: eventTs,
        data: {
          phase,
          progress_status: progressStatus || 'completed',
          message,
        },
        output: null,
        result: null,
        _isScratchpad: false,
        _isGenericProgress: true,
        _progressPhase: phase,
        _toolName: null,
      };
      return { ...state, steps: [...state.steps, step] };
    }

    // 'reasoning_done' and other ad-hoc messages are noise; the live
    // step state is enough.
    return state;
  }

  return state;
}

/**
 * Convenience: fold an entire stream of events into final state.
 * Mostly useful for tests with a fixed event log.
 */
export function reduceAll(events, initial = initialStreamState(), now = Date.now) {
  return events.reduce((s, e) => reduceStream(s, e, now), initial);
}

/**
 * Parse a chunk of text from an SSE response body into discrete events.
 *
 * Returns { events, remainder } — `remainder` is the trailing partial
 * frame (no blank line yet) that the caller should prepend to the next
 * chunk. Each event has the JSON `data:` line already parsed.
 */
export function parseSSEChunk(buffer) {
  const events = [];
  let cursor = 0;
  while (true) {
    const sep = buffer.indexOf('\n\n', cursor);
    if (sep === -1) break;
    const frame = buffer.slice(cursor, sep);
    cursor = sep + 2;

    let eventName = null;
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const dataText = dataLines.join('\n');
    const parsed = safeJsonParse(dataText);
    if (parsed) {
      // The parsed `data` object usually has a `type` field already; if
      // not, fall back to the `event:` line.
      if (!parsed.type && eventName) parsed.type = eventName;
      events.push(parsed);
    }
  }
  return { events, remainder: buffer.slice(cursor) };
}

/**
 * Async generator over an SSE Response body. Yields parsed events.
 * Caller is responsible for fetching with the right headers.
 */
export async function* iterateSSE(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSSEChunk(buffer);
      buffer = remainder;
      for (const event of events) yield event;
    }
    // Flush any trailing frame
    if (buffer.trim()) {
      const { events } = parseSSEChunk(buffer + '\n\n');
      for (const event of events) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
