import { trackArtifactBuilt as _trackArtifactBuilt, trackTokenCapHit as _trackTokenCapHit } from './analytics';

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
//   response.artifact_created   — an artifact this turn produced (any type);
//                                 carries an `artifact` payload → one card
//   response.completed | failed — terminal
//
// We collapse each scratchpad cell (start → end → progress → result) into
// a single ThinkingStep. response.artifact_created produces a separate
// "Artifact" step (card) — the single, deterministic source of artifact
// cards for every type, emitted by the harness at turn end and replayed
// identically on reload.
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
    /** Live "train of thought" text that isn't part of the final answer
     *  (extended-thinking / reasoning deltas). A single ephemeral burst —
     *  NOT a step, so it never accumulates into the persisted steps list.
     *  `{ text, startedAt, _isPreamble? } | null`. `_isPreamble` marks
     *  reclassified narration so the next real reasoning delta replaces
     *  it instead of appending. Cleared whenever body text starts
     *  streaming or the turn finishes. */
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

/** A tool call is starting mid-turn — compute the currentThought/bodyText
 *  patch for it.
 *
 *  Any answer text that streamed before this tool call was
 *  preamble/narration ("let me check X first…"), NOT the final answer —
 *  the turn isn't over, the model is about to act on a tool result and
 *  keep going (see anton's tool loop). Move that text into the ephemeral
 *  currentThought so it reads as inner dialogue, and reset bodyText so
 *  only the FINAL round's text (the one with no tool call after it) ends
 *  up as the persisted answer. Preserves live streaming: the preamble
 *  still streamed token-by-token into the answer area first; this just
 *  relocates it once we learn it was preamble.
 *
 *  When there's no un-committed answer text, the tool call instead seals
 *  the current burst: currentThought is reset to null so a reasoning
 *  burst that resumes after the tool starts fresh rather than appending
 *  to the pre-tool one (bursts separated by a tool call are distinct).
 *  (ENG-1108) */
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
    // Key upgrade-intent signal: the turn was blocked on credits. Fire once
    // here, on receipt — not in the render path (ChatView), which re-runs every
    // paint.
    //
    // All THREE out-of-credits codes count, because each one is a paywall
    // impression and they are simply different ways of being out of credits:
    //   token_limit                   a drained wallet mid-turn (the original
    //                                 ENG-385 signal)
    //   included_allowance_exhausted  the free monthly allowance is spent, not
    //                                 the wallet (ENG-1537). Splitting it out
    //                                 into its own code would otherwise have
    //                                 silently dropped it from this metric —
    //                                 and a never-topped-up org is precisely
    //                                 the cohort this exists to measure, since
    //                                 `_enabled_aware_default` steers it onto
    //                                 the free-bucket model.
    //   model_access_denied           legacy per-model credit denial (ENG-1533).
    //                                 It renders its own "needs credits" card,
    //                                 so it was a paywall impression with no
    //                                 impression event at all.
    //
    // Two codes are deliberately NOT counted. `model_disabled` — an admin
    // turned the model off, and credits do not unlock it, so it is not upgrade
    // intent. `rate_limited` — a velocity limit was never upgrade intent, and
    // counting it would inflate the signal with users who already pay.
    //
    // One event carrying `reason` rather than three events, so the impression
    // stays a single series and keeps this once-per-receipt guarantee.
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

  // Inline artifact card. The harness emits one of these at turn end for
  // every artifact the turn produced (any type — HTML, dataset, doc,
  // image…), detected via the artifacts-dir diff, and replays them
  // identically on reload. This is the single, deterministic source of
  // artifact cards. Deduped by slug/path so a replay can't double a card.
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
        title: art.title || art.slug || 'Artifact',
        file_path: filePath,
        path: filePath,
        ext: art.ext || '',
        action: art.type || 'artifact',
        // Identity + publish state, carried through verbatim. The server builds
        // this card AFTER the turn's publish reconciliation precisely so it can
        // arrive with its URL already on it, and on an org deployment that URL is
        // the only route to the artifact's content — the card is addressed by
        // projectId + slug there, not by a path the server refuses to serve.
        // Dropping these left the inline card unable to open the artifact it had
        // just announced.
        id: art.id || '',
        slug: art.slug || '',
        publishedUrl: art.publishedUrl || '',
        projectId: art.projectId || '',
        projectName: art.projectName || '',
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

  // Inline skill-draft card. The harness emits this at turn end for a skill the
  // agent BUILT this turn (via skill-creator), detected via the skill-drafts
  // dir diff. A skill is NOT an artifact and is NOT auto-saved — this card lets
  // the user Save or Download it. Self-contained payload (full SKILL.md +
  // sibling files) so it renders + downloads identically on reload.
  //
  // Deduped by slug WITHIN a turn so a replay can't double a card. Across turns
  // a refined skill re-emits (server diffs SKILL.md content); the chat renderer
  // shows only the latest turn's card per slug (see latestSkillCardIndexByKey).
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
    // No id, no card. Everything that retires a question matches on
    // question_id: the dedupe guard below, the `ask_user_answered` branch, and
    // App.jsx's composer interception. An id-less question would be both
    // un-dedupable and un-retirable — stuck at `answer: null` forever, so
    // `pendingQuestionFor` keeps returning it and the composer stays hijacked
    // for the life of the live-steps entry. The server always sends an id, so
    // this is defence in depth; it earns its place because it is the one
    // malformed payload whose failure mode is permanent rather than cosmetic.
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
      // Unlike scratchpad (where the SAME name deliberately groups
      // multiple cells into one continuing notebook), each tool call is
      // its own independent invocation — never a "step" of another one.
      // Keying by tool_use_id gives every call its own pad in
      // ScratchpadModal instead of collapsing unrelated calls into one
      // synthetic "Untitled" pad with a misleading "step 1/3" counter.
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
    // Narrowed from the old "patch the last in-progress step" fallback:
    // without a matching _isToolCall step for this exact tool_use_id, this
    // must be a no-op. A blind fallback could close an unrelated step
    // (e.g. a scratchpad cell still running in the same turn) if this
    // tool call's only progress event was ever lost to a race.
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
      // Tool's own verdict (anton ToolOutcome.ok, ENG-1276) — reuses the
      // same cellStatus/'error' convention ThinkingStep.jsx already
      // renders for a failed scratchpad cell, rather than inventing a
      // second failure indicator. undefined/true stay unmarked (rendered
      // as success) — only an explicit false marks the step failed.
      // Without this, tool_done firing (unconditional by design, even on
      // a handler exception) rendered as success everywhere (PR #304
      // review, anton repo).
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

  // ── Hermes reasoning/thinking ────────────────────────────────────
  // Streaming reasoning text from the model's extended thinking. This is
  // NOT part of the final answer, so it never becomes a step (ENG-1108) —
  // it accumulates into the ephemeral `currentThought` burst instead,
  // which the UI renders as a single live line and drops entirely once
  // the burst ends or the turn completes.
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

    // anton is deliberately idle, waiting out a velocity rate-limit before
    // resuming the same step (ENG-1537). Surfaced as an ephemeral live line —
    // the turn is NOT failing, so it must not look like an error, and it must
    // not be dropped: a silent 90s pause is indistinguishable from a hang, and
    // that is how a correct wait gets reported as a freeze. Reuses
    // `currentThought` rather than adding UI, so the existing working state
    // carries it and the user never has to type "continue".
    //
    // Every other ad-hoc phase falls through to the `return state` at the
    // bottom of this block and is discarded as noise — which is exactly why
    // this needs an explicit branch.
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
