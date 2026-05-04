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
 *  flows, so requiring in_progress here would silently drop the output. */
function patchLastScratchpadStep(steps, patch) {
  if (steps.length === 0) return steps;
  const idx = steps.length - 1;
  const last = steps[idx];
  if (!last._isScratchpad) return steps;
  const next = steps.slice();
  next[idx] = { ...last, ...patch };
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
  if (role === 'thought.scratchpad.start') {
    const id = `step-${state.steps.length + 1}`;
    const ts = now();
    const step = {
      id,
      label: 'Running code',
      badge: 'Script',
      icon: 'code',
      status: 'in_progress',
      startedAt: ts,
      completedAt: null,
      // Fine-grained timing — used to split "reasoning" (LLM deciding
      // what to do) from "execution" (runtime running the code).
      reasoningStartedAt: ts,
      executionStartedAt: null,
      executionCompletedAt: null,
      data: null,
      output: null,
      result: null,
      _isScratchpad: true,
      _scratchpadTabId: null,
    };
    return { ...state, steps: [...state.steps, step] };
  }

  // Scratchpad input — the JSON contains action, name, code,
  // one_line_description, etc. Use one_line_description as the visible
  // label (matches mdb-ai's convention) and `name` as the tab id so
  // multiple cells under the same scratchpad name group together.
  if (role === 'thought.scratchpad.end') {
    // The server clips content at ~2KB so long cells fail full JSON
    // parse. Fall back to regex-extracting the fields we care about
    // so the step still gets its real label.
    const parsed = safeJsonParse(event.content);
    const oneLiner = parsed?.one_line_description ?? extractJsonString(event.content, 'one_line_description');
    const name     = parsed?.name                  ?? extractJsonString(event.content, 'name');
    const code     = parsed?.code                  ?? extractJsonString(event.content, 'code');
    if (!oneLiner && !name && !code) return state;
    const steps = patchLastScratchpadStep(state.steps, {
      label: oneLiner || name || 'Running code',
      data: parsed || { one_line_description: oneLiner, name, code, _truncated: true },
      _scratchpadTabId: name || null,
    });
    return { ...state, steps };
  }

  // Scratchpad output — JSON of { code, stdout, stderr, ... }. The
  // result event is the canonical "this cell finished" signal: it
  // arrives whether or not the upstream emitted scratchpad_done first,
  // and it carries the actual stdout we want to surface. Server can
  // truncate this at ~2KB, so fall back to regex-extracting stdout.
  if (role === 'thought.scratchpad.result') {
    const stdout = bestEffortField(event.content, 'stdout');
    const stderr = bestEffortField(event.content, 'stderr');
    const parsed = safeJsonParse(event.content);
    const ts = now();
    // The result is also the canonical end of execution if we never
    // got a `scratchpad_done` phase (some flows skip it).
    const last = state.steps[state.steps.length - 1];
    const executionCompletedAt = last?._isScratchpad
      ? (last.executionCompletedAt || ts)
      : ts;
    const steps = patchLastScratchpadStep(state.steps, {
      output: typeof stdout === 'string' ? stdout : null,
      result: parsed || { stdout, stderr, _truncated: true },
      status: 'completed',
      completedAt: ts,
      executionCompletedAt,
      ...(typeof stderr === 'string' && stderr ? { stderr } : null),
    });
    return { ...state, steps };
  }

  // Progress markers
  if (role === 'thought.progress') {
    const phase = event.phase;
    const content = event.content;

    // Cell finished — flip the trailing in-progress scratchpad to
    // completed if the .result hasn't arrived yet. (When .result does
    // come in, it'll carry the same status flip plus the output.)
    // Either way, this is when execution wraps.
    if (phase === 'scratchpad_done') {
      const ts = now();
      const stepsClosed = closeOpenScratchpadStep(state.steps, ts);
      const stepsTimed = patchLastScratchpadStep(stepsClosed, {
        executionCompletedAt: ts,
      });
      return { ...state, steps: stepsTimed };
    }

    // Cell starting — already marked in_progress in .start, but if
    // somehow we missed .start (out-of-order), upsert a step now.
    // Either way, mark execution start (reasoning is over).
    if (phase === 'scratchpad_start') {
      const last = state.steps[state.steps.length - 1];
      const ts = now();
      if (!last || last.status !== 'in_progress') {
        const seeded = reduceStream(state, {
          type: 'response.in_progress',
          thought_role: 'thought.scratchpad.start',
        }, now);
        return { ...seeded, steps: patchLastScratchpadStep(seeded.steps, { executionStartedAt: ts }) };
      }
      return { ...state, steps: patchLastScratchpadStep(state.steps, { executionStartedAt: ts }) };
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
      if (payload && (payload.file_path || payload.title)) {
        const id = `artifact-${state.steps.length + 1}`;
        const step = {
          id,
          label: payload.title || payload.file_path || 'Artifact',
          badge: 'Artifact',
          icon: 'sparkle',
          status: 'completed',
          startedAt: now(),
          completedAt: now(),
          data: payload,
          output: null,
          result: null,
          _isScratchpad: false,
          _scratchpadTabId: null,
        };
        return {
          ...state,
          awaitingArtifactPayload: false,
          steps: [...state.steps, step],
        };
      }
      // Wasn't JSON after all — clear the flag and ignore.
      return { ...state, awaitingArtifactPayload: false };
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
