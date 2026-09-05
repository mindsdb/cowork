import { trackArtifactBuilt as _trackArtifactBuilt, trackTokenCapHit as _trackTokenCapHit } from './analytics';

// Adapt Anton SSE events into conversation and ThinkingStep state.
// Correlate each scratchpad cell’s events into one step; artifact_created supplies artifact cards
// in live streams and replay.
// Callers can inject now for timestamps and set replay to suppress analytics.

export function initialStreamState() {
  return {
    responseId: null,
    conversationId: null,
    /** 'pending' | 'thinking' | 'streaming' | 'done' | 'error' */
    status: 'pending',
    startedAt: null,
    /** ThinkingStep[] in order */
    steps: [],
    /**
     * Ephemeral {text, startedAt, _isPreamble?} | null; never persist as a step.
     * _isPreamble makes the next reasoning delta replace reclassified narration; clear on body text
     * or turn end.
     */
    currentThought: null,
    /** Streaming/finished body text (markdown). */
    bodyText: '',
    /** Harness/agent ID from `response.created` (e.g. 'anton', 'hermes'). */
    harness: null,
    /** Surfaced for diagnostics if a failure event arrives. */
    error: null,
    /** Stable failure code from `response.failed` (e.g. 'token_limit'). */
    errorCode: null,
  };
}

/**
 * Accept late results even after scratchpad_done.
 * Prefer patchScratchpadStepById when tool_use_id exists: queued multi-cell turns cannot safely
 * patch the last step.
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

/** Close any still-open inspectable step on terminal stream events.
 *  Keep this scoped to step types whose lifetime is owned by this
 *  adapter so future progress/artifact step types can define their
 *  own terminal behavior. */
function closeOpenInspectableSteps(steps, completedAt) {
  let changed = false;
  const next = steps.map((step) => {
    if (
      step?.status !== 'in_progress'
      || (!step._isScratchpad && !step._isToolCall)
    ) {
      return step;
    }
    changed = true;
    return { ...step, status: 'completed', completedAt };
  });
  return changed ? next : steps;
}

/** Same but only acts on the trailing in-progress scratchpad — used
 *  by scratchpad_done progress markers before the result event may
 *  have arrived. */
function closeOpenScratchpadStep(steps, completedAt) {
  if (steps.length === 0) return steps;
  const idx = steps.length - 1;
  const last = steps[idx];
  if (!last._isScratchpad || last.status !== 'in_progress') return steps;
  const next = steps.slice();
  next[idx] = { ...last, status: 'completed', completedAt };
  return next;
}

/** Build a descriptive label for a Hermes tool-call step from the
 *  tool name and its arguments dict. Shows a preview of the actual
 *  command/code so the user can see what's running at a glance. */
function toolCallLabel(name, args) {
  const preview =
    args.command || args.code || args.path || args.pattern ||
    args.query || args.url || args.content || '';
  if (!preview) return name;
  // First line only, truncated.
  const first = String(preview).split('\n')[0];
  const short = first.length > 70 ? first.slice(0, 67) + '…' : first;
  return `${name}: ${short}`;
}

/** Truncate accumulated thought/reasoning text to its last meaningful
 *  line, for display as a single live "current thought" line. */
export function truncateLabel(text) {
  if (!text) return 'Reasoning…';
  // Take the last meaningful line (reasoning streams append).
  const lines = text.trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return last.length > 80 ? last.slice(0, 77) + '…' : last || 'Reasoning…';
}

/**
 * A subsequent tool call proves streamed body text was preamble; move it into currentThought so it
 * is not persisted as the answer.
 * With no pending body text, clear the thought so reasoning after the tool starts a fresh burst.
 */
function reclassifyPreambleOnToolStart(state, eventTs) {
  const preamble = (state.bodyText || '').trim();
  if (!preamble) return { currentThought: null };
  return {
    currentThought: {
      text: preamble,
      startedAt: state.currentThought?.startedAt || eventTs,
      _isPreamble: true,
    },
    bodyText: '',
  };
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

/** Classify a finished cell as 'ok' | 'timeout' | 'error'. Prefer the
 *  server-provided `cell_status` (cowork-server derives it from the cell's
 *  structured error field); fall back to deriving from the parsed cell so
 *  older servers still distinguish a killed cell from a clean one. */
function deriveCellStatus(serverStatus, parsedCell) {
  if (serverStatus === 'ok' || serverStatus === 'timeout' || serverStatus === 'error') {
    return serverStatus;
  }
  const err = parsedCell && typeof parsedCell.error === 'string' ? parsedCell.error : '';
  if (!err) return 'ok';
  const low = err.toLowerCase();
  if (low.includes('timed out') || low.includes('of inactivity') || low.includes('cell killed')) {
    return 'timeout';
  }
  return 'error';
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
export function reduceStream(state, event, now = Date.now, { replay = false } = {}) {
  if (!event || typeof event !== 'object') return state;
  const type = event.type;

  // Use server at_ms so replay preserves reasoning/execution durations; older events fall back to
  // the injected live clock.
  const eventTs = (typeof event.at_ms === 'number' && Number.isFinite(event.at_ms))
    ? event.at_ms
    : now();

  // ── Lifecycle ─────────────────────────────────────────────────────
  if (type === 'response.created') {
    return {
      ...state,
      responseId: event.response?.id ?? state.responseId,
      conversationId: event.conversation_id ?? state.conversationId,
      harness: event.harness ?? state.harness,
      startedAt: state.startedAt ?? now(),
      status: 'thinking',
    };
  }

  if (type === 'response.completed') {
    return {
      ...state,
      steps: closeOpenInspectableSteps(state.steps, eventTs),
      status: 'done',
      currentThought: null,
    };
  }

  if (type === 'response.failed') {
    // Record credit-block impressions once on receipt, excluding replay and render paths.
    // Admin-disabled models and velocity limits are not credit blocks; do not count them as upgrade
    // intent.
    if (!replay && (event.code === 'token_limit' || event.code === 'included_allowance_exhausted' || event.code === 'model_access_denied')) {
      try { _trackTokenCapHit(event.code); }
      catch { /* analytics must never break streaming */ }
    }
    return {
      ...state,
      steps: closeOpenInspectableSteps(state.steps, eventTs),
      status: 'error',
      error: event.error || event.message || 'Response failed',
      // Stable wire code (e.g. 'token_limit') so the renderer can show a
      // richer affordance — the out-of-credits card — instead of plain text.
      errorCode: event.code || null,
      currentThought: null,
    };
  }

  if (type === 'response.output_text.delta') {
    const delta = typeof event.delta === 'string' ? event.delta : '';
    if (!delta) return state;
    // The model has moved from thinking to producing the visible
    // response — end the current thought burst.
    return { ...state, status: 'streaming', bodyText: state.bodyText + delta, currentThought: null };
  }

  // Dedupe artifact_created by slug/path so replay cannot produce a second card.
  if (type === 'response.artifact_created') {
    const art = (event.artifact && typeof event.artifact === 'object') ? event.artifact : {};
    const key = art.slug || art.file_path || art.path || '';
    if (key && state.steps.some((s) => s.badge === 'Artifact' && s._artifactKey === key)) {
      return state;
    }
    const filePath = art.file_path || art.path || '';
    const step = {
      id: `artifact-${art.slug || state.steps.length + 1}`,
      label: art.title || art.slug || 'Artifact',
      badge: 'Artifact',
      icon: 'sparkle',
      status: 'completed',
      startedAt: eventTs,
      completedAt: eventTs,
      data: {
        // Preserve the full server card: evolving capabilities/addressing must remain available
        // before the next artifact-list reload.
        ...art,
        title: art.title || art.slug || 'Artifact',
        file_path: filePath,
        path: filePath,
        ext: art.ext || '',
        action: art.type || 'artifact',
        // Preserve the stable legacy shape for consumers that use truthiness.
        id: art.id || '',
        slug: art.slug || '',
        publishedUrl: art.publishedUrl || '',
        projectId: art.projectId || '',
        projectName: art.projectName || '',
        // Needed to render an inline thumbnail / in-app preview for image
        // artifacts (ENG-1998) — without it the card has no URL to fetch
        // bytes from until the artifact is reopened from the persisted list.
        serveUrl: art.serveUrl || '',
      },
      output: null,
      result: null,
      _artifactKey: key,
      _isScratchpad: false,
      _scratchpadTabId: null,
    };
    if (!replay) {
      try { _trackArtifactBuilt(art.type || 'unknown'); }
      catch { /* analytics must never break streaming */ }
    }
    return { ...state, steps: [...state.steps, step] };
  }

  // Skill drafts are self-contained, user-saved resources, separate from artifacts.
  // Dedupe slugs within a turn; latestSkillCardIndexByKey selects the newest revision across turns.
  if (type === 'response.skill_created') {
    const sk = (event.skill && typeof event.skill === 'object') ? event.skill : {};
    const key = sk.slug || sk.label || sk.name || '';
    if (key && state.steps.some((s) => s.badge === 'Skill' && s._skillKey === key)) {
      return state;
    }
    const step = {
      id: `skill-${sk.slug || state.steps.length + 1}`,
      label: sk.name || sk.slug || 'Skill',
      badge: 'Skill',
      icon: 'cube',
      status: 'completed',
      startedAt: eventTs,
      completedAt: eventTs,
      data: {
        slug: sk.slug || '',
        label: sk.label || sk.slug || '',
        name: sk.name || sk.slug || 'Skill',
        description: sk.description || '',
        instructions: sk.instructions || '',
        skill_md: sk.skill_md || '',
        files: Array.isArray(sk.files) ? sk.files : [],
        projects: Array.isArray(sk.projects) ? sk.projects : undefined,
      },
      output: null,
      result: null,
      _skillKey: key,
      _isScratchpad: false,
      _scratchpadTabId: null,
    };
    return { ...state, steps: [...state.steps, step] };
  }

  // Inline ask_user card. The harness pauses mid-turn to ask the user a
  // multiple-choice question; the payload is self-contained so the card
  // renders from this event alone, including on replay. Deduped by
  // question_id so a /tail replay from seq 0 can't double the card.
  if (type === 'response.ask_user') {
    const key = event.question_id || '';
    // Reject id-less questions: they cannot be deduplicated or retired and would permanently hijack
    // the composer.
    if (!key) return state;
    // Idempotent: /tail replays from seq 0, so the same question arrives
    // again on every reconnect.
    if (state.steps.some((s) => s.badge === 'AskUser' && s._questionKey === key)) {
      return state;
    }
    const step = {
      id: `question-${key}`,
      label: event.prompt || 'Question',
      badge: 'AskUser',
      icon: 'question',
      status: 'in_progress',
      startedAt: eventTs,
      completedAt: null,
      data: {
        question_id: key,
        prompt: event.prompt || '',
        options: Array.isArray(event.options) ? event.options : [],
        select: event.select === 'many' ? 'many' : 'one',
        allow_custom: event.allow_custom !== false,
        timeout_s: event.timeout_s ?? null,
        answer: null,
      },
      output: null,
      result: null,
      _questionKey: key,
      _isScratchpad: false,
      _scratchpadTabId: null,
    };
    return { ...state, steps: [...state.steps, step] };
  }

  // Retires a published ask_user question once the user answers, cancels,
  // or the server times it out. Never sent for a question that wasn't
  // published, so an unknown question_id is ignored rather than throwing.
  if (type === 'response.ask_user_answered') {
    const key = event.question_id || '';
    if (!key) return state;
    let found = false;
    const steps = state.steps.map((s) => {
      if (s.badge !== 'AskUser' || s._questionKey !== key) return s;
      found = true;
      return {
        ...s,
        status: 'completed',
        completedAt: eventTs,
        data: {
          ...s.data,
          answer: {
            status: event.status || 'answered',
            values: Array.isArray(event.values) ? event.values : [],
            text: event.text || '',
          },
        },
      };
    });
    return found ? { ...state, steps } : state;
  }

  // ── thought.* sub-events live under response.in_progress ──────────
  if (type !== 'response.in_progress') return state;

  const role = event.thought_role;

  // Show a cell before its input arrives. Capture tool_use_id to correlate later results when
  // several cells are queued.
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
      // Actual runtime elapsed milliseconds from scratchpad_done.eta_seconds, not event arrival
      // time.
      executionDurationMs: null,
      data: null,
      output: null,
      result: null,
      _isScratchpad: true,
      _scratchpadTabId: null,
      _toolUseId: event.tool_use_id || null,
    };
    // Any answer text before this tool call was preamble → move it to
    // the thought line; only the final round's text stays as the answer.
    return {
      ...state,
      steps: [...state.steps, step],
      ...reclassifyPreambleOnToolStart(state, eventTs),
    };
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
      // Lifecycle stays 'completed' (so the timeline's aggregate-done logic
      // isn't broken), but cellStatus carries whether the cell was killed /
      // errored so the renderer can mark it distinctly instead of showing a
      // dead cell as a clean finish.
      cellStatus: deriveCellStatus(event.cell_status, parsed),
      completedAt: eventTs,
      executionCompletedAt,
      ...(typeof stderr === 'string' && stderr ? { stderr } : null),
    };
    const byId = patchScratchpadStepById(state.steps, toolUseId, patch);
    return { ...state, steps: byId || patchLastScratchpadStep(state.steps, patch) };
  }

  // ── Hermes tool-call events ──────────────────────────────────────
  // Generic tool-call start/end from harnesses that don't use
  // anton's scratchpad model (e.g. Hermes). Creates steps so the
  // ThinkingBlock shows tool activity.
  if (role === 'thought.tool_call.start') {
    const id = `step-${state.steps.length + 1}`;
    const toolName = event.content || 'Tool call';
    const args = event.args || {};
    const label = toolCallLabel(toolName, args);
    const step = {
      id,
      label,
      badge: 'Tool',
      icon: 'code',
      status: 'in_progress',
      startedAt: eventTs,
      completedAt: null,
      data: args,
      output: null,
      result: null,
      _isScratchpad: false,
      _isToolCall: true,
      // Group scratchpad cells by notebook, but keep independent tool calls in separate tabs keyed
      // by tool_use_id.
      _scratchpadTabId: event.tool_use_id || null,
      _toolUseId: event.tool_use_id || null,
    };
    // Any answer text before this tool call was preamble → move it to
    // the thought line; only the final round's text stays as the answer.
    return {
      ...state,
      steps: [...state.steps, step],
      ...reclassifyPreambleOnToolStart(state, eventTs),
    };
  }

  if (role === 'thought.tool_call.end') {
    // Without an exact tool-use match, leave state unchanged; a generic fallback could complete an
    // unrelated running cell.
    const toolUseId = event.tool_use_id || null;
    if (!toolUseId) return state;
    const idx = state.steps.findIndex((s) => s._isToolCall && s._toolUseId === toolUseId);
    if (idx === -1) return state;
    const etaSeconds = typeof event.eta_seconds === 'number' && Number.isFinite(event.eta_seconds)
      ? event.eta_seconds
      : null;
    const steps = state.steps.slice();
    steps[idx] = {
      ...steps[idx],
      status: 'completed',
      completedAt: eventTs,
      output: typeof event.content === 'string' ? event.content.slice(0, 2048) : null,
      ...(etaSeconds != null ? { executionDurationMs: Math.max(0, Math.round(etaSeconds * 1000)) } : null),
      // tool_done always fires, even on handler failure. Only explicit ok:false marks execution as
      // failed.
      ...(event.ok === false ? { cellStatus: 'error' } : null),
    };
    return { ...state, steps };
  }

  if (role === 'thought.tool_call.progress') {
    const toolUseId = event.tool_use_id || null;
    const text = event.content || '';
    if (!toolUseId || !text) return state;

    const idx = state.steps.findIndex((s) => s._isToolCall && s._toolUseId === toolUseId);
    if (idx === -1) {
      // First progress event for this tool call — seed a step, same
      // idiom as the scratchpad_start seed-if-missing case above.
      const seeded = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.tool_call.start',
        tool_use_id: toolUseId,
        content: event.tool_name || 'Tool',
        at_ms: eventTs,
      }, now);
      const newIdx = seeded.steps.findIndex((s) => s._isToolCall && s._toolUseId === toolUseId);
      if (newIdx === -1) return seeded;
      const steps = seeded.steps.slice();
      steps[newIdx] = { ...steps[newIdx], data: { ...steps[newIdx].data, one_line_description: text } };
      return { ...seeded, steps };
    }

    const steps = state.steps.slice();
    steps[idx] = { ...steps[idx], data: { ...steps[idx].data, one_line_description: text } };
    return { ...state, steps };
  }

  // Reasoning/thinking deltas update only the ephemeral thought, never the persisted answer or
  // steps.
  if (role === 'thought.progress' && (event.subtype === 'reasoning' || event.subtype === 'thinking')) {
    const text = event.content || '';
    if (!text) return state;
    // Reclassified pre-tool narration is its own display burst. The next
    // genuine reasoning delta starts a new burst even if the tool protocol
    // has not emitted its completion marker yet.
    const resumesAfterPreamble = state.currentThought?._isPreamble === true;
    const prevText = resumesAfterPreamble ? '' : (state.currentThought?.text || '');
    const startedAt = resumesAfterPreamble ? eventTs : (state.currentThought?.startedAt || eventTs);
    return { ...state, currentThought: { text: prevText + text, startedAt } };
  }

  // Progress markers
  if (role === 'thought.progress') {
    const phase = event.phase;

    // Surface a rate-limit wait as live thought, not terminal failure, so a long intentional pause
    // does not look like a hang.
    if (phase === 'rate_limited') {
      const text = event.message || event.content || 'Rate limited — waiting';
      // A fresh burst, not an append: this interrupts whatever the model was
      // narrating, and the next real reasoning delta should replace it.
      return { ...state, currentThought: { text, startedAt: eventTs } };
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

    // Mark execution start on the matching tool id; upsert if the earlier start event was missed.
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

    // Artifact cards no longer come from the publish_or_preview marker
    // (HTML-only, and dependent on the agent calling that tool). They now
    // arrive as `response.artifact_created` events at turn end for every
    // artifact type — handled near the top of this reducer.

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
 * Return parsed JSON events and the trailing incomplete SSE frame as remainder; prepend it to the
 * next chunk.
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
