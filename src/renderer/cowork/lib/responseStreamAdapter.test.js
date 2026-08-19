import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceStream, reduceAll, truncateLabel } from './responseStreamAdapter';

const ASK = {
  type: 'response.ask_user',
  question_id: 'ask:1',
  prompt: 'Which database?',
  select: 'one',
  allow_custom: true,
  timeout_s: 300,
  options: [
    { value: 'pg', label: 'postgres', detail: 'primary' },
    { value: 'my', label: 'mysql', detail: '' },
  ],
};

const ANSWERED = {
  type: 'response.ask_user_answered',
  question_id: 'ask:1',
  status: 'answered',
  values: ['pg'],
  text: '',
};

const question = (state) => state.steps.find((s) => s.badge === 'AskUser');

describe('responseStreamAdapter — ask_user', () => {
  it('creates a badged step carrying the whole question', () => {
    const state = reduceStream(initialStreamState(), ASK);
    const step = question(state);
    expect(step).toBeTruthy();
    expect(step.badge).toBe('AskUser');
    expect(step.status).toBe('in_progress');
    expect(step._questionKey).toBe('ask:1');
    expect(step.data.prompt).toBe('Which database?');
    expect(step.data.select).toBe('one');
    expect(step.data.allow_custom).toBe(true);
    expect(step.data.options.map((o) => o.value)).toEqual(['pg', 'my']);
    expect(step.data.answer).toBeNull();
  });

  it('is idempotent — a replayed duplicate does not add a second card', () => {
    const once = reduceStream(initialStreamState(), ASK);
    const twice = reduceStream(once, ASK);
    expect(twice.steps.filter((s) => s.badge === 'AskUser')).toHaveLength(1);
  });

  it('marks the question answered in place', () => {
    const state = reduceAll([ASK, ANSWERED]);
    const step = question(state);
    expect(state.steps.filter((s) => s.badge === 'AskUser')).toHaveLength(1);
    expect(step.status).toBe('completed');
    expect(step.data.answer).toEqual({ status: 'answered', values: ['pg'], text: '' });
  });

  it('records a skip as cancelled', () => {
    const state = reduceAll([ASK, { ...ANSWERED, status: 'cancelled', values: [] }]);
    expect(question(state).data.answer.status).toBe('cancelled');
  });

  it('replaying a finished exchange yields an answered card, never live buttons', () => {
    // This is the /tail-from-seq-0 case: the reducer runs over the whole
    // buffer, so an already-answered question must not come back clickable.
    let state = initialStreamState();
    for (const ev of [ASK, ANSWERED]) {
      state = reduceStream(state, ev, Date.now, { replay: true });
    }
    expect(question(state).status).toBe('completed');
    expect(question(state).data.answer.status).toBe('answered');
  });

  it('an answer for an unknown question is ignored rather than throwing', () => {
    const state = reduceStream(initialStreamState(), ANSWERED);
    expect(state.steps).toHaveLength(0);
  });

  it('drops an ask_user with no question_id', () => {
    // Every retirement path matches on question_id, so an id-less question
    // could never be deduped, answered, or timed out — it would sit at
    // `answer: null` forever and keep the composer redirected into a question
    // nobody can answer. Identity-preserving, like any other ignored event.
    const before = initialStreamState();
    expect(reduceStream(before, { ...ASK, question_id: '' })).toBe(before);
    expect(reduceStream(before, { ...ASK, question_id: undefined })).toBe(before);
  });

  it('leaves state untouched for an unknown event type', () => {
    // Documents the silent-drop behaviour the server-side kill switch exists
    // to protect against.
    const before = initialStreamState();
    expect(reduceStream(before, { type: 'response.some_future_thing' })).toBe(before);
  });
});

describe('currentThought (ENG-1108 — live train of thought, not a step)', () => {
  const now = () => 1000;

  it('accumulates reasoning deltas into a single ephemeral burst, not a step', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Considering ' },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'the options.' },
    ], initialStreamState(), now);

    expect(state.currentThought).toEqual({ text: 'Considering the options.', startedAt: 1000 });
    // Never becomes a persisted step.
    expect(state.steps).toEqual([]);
  });

  it('surfaces a rate-limit wait as a live line, not silence (ENG-1537)', () => {
    // anton pauses in-turn to wait out a velocity limit. Every OTHER ad-hoc
    // progress phase is discarded by this reducer as noise ("the live step
    // state is enough"), so without an explicit branch the notice was sent by
    // the server and thrown away here — leaving a silent 90s pause that is
    // indistinguishable from a hang.
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        phase: 'rate_limited',
        message: 'waiting 30s before continuing',
      },
    ], initialStreamState(), now);

    expect(state.currentThought).toEqual({
      text: 'waiting 30s before continuing',
      startedAt: 1000,
    });
    // The turn is still alive and this is not an error state.
    expect(state.status).not.toBe('error');
    expect(state.errorCode).toBeNull();
    // Ephemeral, exactly like a reasoning burst — never a persisted step.
    expect(state.steps).toEqual([]);
  });

  it('still discards other ad-hoc progress phases as noise', () => {
    // Guard the narrowness of the branch above: it must not turn every phase
    // marker into a visible line.
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        phase: 'reasoning_done',
        message: 'ignored',
      },
    ], initialStreamState(), now);
    expect(state.currentThought).toBeNull();
  });

  it('clears the burst once body text starts streaming', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Thinking…' },
      { type: 'response.output_text.delta', delta: 'Here' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
    expect(state.bodyText).toBe('Here');
  });

  it('clears the burst when a tool call starts, and a later burst starts fresh (no leak from the earlier one)', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'First thought.' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Second thought.' },
    ], initialStreamState(), now);

    // Only the second burst survives — no trailing text from the first.
    expect(state.currentThought).toEqual({ text: 'Second thought.', startedAt: 1000 });
    // The tool call is a real step; reasoning never is.
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]._isScratchpad).toBe(true);
  });

  it('clears the burst when a Hermes tool call starts', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'thinking', content: 'Deciding…' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.start', content: 'search', tool_use_id: 'a' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
  });

  it('clears the burst on response.completed', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Wrapping up.' },
      { type: 'response.completed' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
    expect(state.status).toBe('done');
  });

  it('clears the burst on response.failed', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Uh oh.' },
      { type: 'response.failed', error: 'boom' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
    expect(state.status).toBe('error');
  });

  it('ignores empty reasoning content without starting a burst', () => {
    const state = reduceStream(initialStreamState(), {
      type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: '',
    }, now);
    expect(state.currentThought).toBeNull();
  });
});

describe('preamble reclassification (ENG-1108 — narration before a tool call is not the answer)', () => {
  const now = () => 1000;

  it('moves answer text that precedes a scratchpad tool call into the thought line, clearing bodyText', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: "Let me verify SpaceX's status first." },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
    ], initialStreamState(), now);

    // Preamble is NOT left sitting in the answer…
    expect(state.bodyText).toBe('');
    // …it's shown as the current inner-dialogue thought instead.
    expect(state.currentThought).toEqual({
      text: "Let me verify SpaceX's status first.",
      startedAt: 1000,
      _isPreamble: true,
    });
    // And the tool call still became a real step.
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]._isScratchpad).toBe(true);
  });

  it('moves preamble before a Hermes tool_call.start too', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'Checking the docs.' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.start', content: 'search', tool_use_id: 'a' },
    ], initialStreamState(), now);

    expect(state.bodyText).toBe('');
    expect(state.currentThought).toEqual({
      text: 'Checking the docs.',
      startedAt: 1000,
      _isPreamble: true,
    });
  });

  it('replaces reclassified narration when genuine reasoning resumes', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'Checking the docs.' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.start', content: 'search', tool_use_id: 'a' },
      {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        subtype: 'reasoning',
        content: 'Analyzing the result.',
        at_ms: 2000,
      },
    ], initialStreamState(), now);

    expect(state.currentThought).toEqual({
      text: 'Analyzing the result.',
      startedAt: 2000,
    });
  });

  it('keeps the FINAL round text (no tool call after it) as the answer', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'First, let me check.' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.result', tool_use_id: 'a', content: '{"stdout":"ok"}' },
      { type: 'response.output_text.delta', delta: 'Here is the real answer.' },
      { type: 'response.completed' },
    ], initialStreamState(), now);

    // Only the final round's text survives as the answer — the preamble
    // ("First, let me check.") is gone from bodyText.
    expect(state.bodyText).toBe('Here is the real answer.');
    // Thought line is cleared once the turn completes.
    expect(state.currentThought).toBeNull();
  });

  it('seals the reasoning burst on a tool start when there is no preamble (next burst starts fresh)', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Planning.' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'New plan.' },
    ], initialStreamState(), now);

    // The tool call sealed the first burst, so the resumed reasoning is a
    // fresh burst — no "Planning." leaking into it.
    expect(state.bodyText).toBe('');
    expect(state.currentThought).toEqual({ text: 'New plan.', startedAt: 1000 });
  });
});

describe('truncateLabel', () => {
  it('returns the last non-empty line of accumulated text', () => {
    expect(truncateLabel('First line.\nSecond line.\n\nThird line.')).toBe('Third line.');
  });

  it('falls back to a placeholder for empty text', () => {
    expect(truncateLabel('')).toBe('Reasoning…');
    expect(truncateLabel(null)).toBe('Reasoning…');
  });

  it('truncates a long line and appends an ellipsis', () => {
    const long = 'x'.repeat(120);
    const out = truncateLabel(long);
    expect(out).toBe('x'.repeat(77) + '…');
  });
});

describe('tool_call.progress / tool_call.end (ENG-763 stage 2 — generic tool progress display)', () => {
  const now = () => 1000;

  it('creates a step lazily on the first progress event for a tool call', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      {
        type: 'response.in_progress',
        thought_role: 'thought.tool_call.progress',
        tool_use_id: 'tc_1',
        tool_name: 'streaming_probe',
        content: 'step 1',
      },
    ], initialStreamState(), now);

    expect(state.steps).toHaveLength(1);
    const step = state.steps[0];
    expect(step._isToolCall).toBe(true);
    expect(step._toolUseId).toBe('tc_1');
    expect(step.status).toBe('in_progress');
    expect(step.data.one_line_description).toBe('step 1');
  });

  it('patches the same step in place on subsequent progress events, overwriting the text', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', content: 'step 2' },
    ], initialStreamState(), now);

    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].data.one_line_description).toBe('step 2');
  });

  it('closes the step as completed on tool_call.end', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_1', content: '' },
    ], initialStreamState(), now);

    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].status).toBe('completed');
  });

  it('marks the step cellStatus "error" when tool_call.end carries ok: false', () => {
    // Without this, a failed tool call renders identically to a
    // successful one — tool_done/tool_call.end fires unconditionally by
    // design, so "it closed" was the only signal the UI had (anton PR
    // #304 review).
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_1', ok: false },
    ], initialStreamState(), now);

    expect(state.steps[0].status).toBe('completed');
    expect(state.steps[0].cellStatus).toBe('error');
  });

  it('leaves cellStatus unset when tool_call.end has no ok field or ok: true', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_1' },
    ], initialStreamState(), now);

    expect(state.steps[0].cellStatus).toBeUndefined();

    const state2 = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_2', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_2', ok: true },
    ], initialStreamState(), now);

    expect(state2.steps[0].cellStatus).toBeUndefined();
  });

  it('sets executionDurationMs from eta_seconds on tool_call.end', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_1', eta_seconds: 1.5 },
    ], initialStreamState(), now);

    expect(state.steps[0].executionDurationMs).toBe(1500);
  });

  it('leaves executionDurationMs unset when tool_call.end has no eta_seconds', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_1' },
    ], initialStreamState(), now);

    expect(state.steps[0].executionDurationMs).toBeUndefined();
  });

  it('does not touch any step when tool_call.end arrives with no matching tool-call step', () => {
    // e.g. the tool's only progress event was lost — the step was never
    // created, so tool_call.end must be a strict no-op, not a patch of
    // "the last in-progress step" (which could be an unrelated scratchpad
    // cell running concurrently in the same turn).
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'sp_1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_never_seen', content: 'ignored' },
    ], initialStreamState(), now);

    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]._isScratchpad).toBe(true);
    expect(state.steps[0].status).toBe('in_progress'); // untouched, not silently closed
  });

  it('no-ops on tool_call.end with a missing tool_use_id', () => {
    const state = reduceStream(initialStreamState(), {
      type: 'response.in_progress', thought_role: 'thought.tool_call.end', content: 'ignored',
    }, now);
    expect(state.steps).toEqual([]);
  });

  it('correlates two concurrent tool calls independently', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'web_search', content: 'searching' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_2', tool_name: 'streaming_probe', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.end', tool_use_id: 'tc_1' },
    ], initialStreamState(), now);

    expect(state.steps).toHaveLength(2);
    const [a, b] = state.steps;
    expect(a._toolUseId).toBe('tc_1');
    expect(a.status).toBe('completed');
    expect(b._toolUseId).toBe('tc_2');
    expect(b.status).toBe('in_progress');
    expect(b.data.one_line_description).toBe('step 1');
  });

  it('gives each tool call its own _scratchpadTabId instead of sharing null', () => {
    // ScratchpadModal groups cells by _scratchpadTabId — if every
    // tool-call step shared the same value (null), three unrelated
    // test_tool invocations would collapse into one synthetic pad and
    // render as "step 1/3", "step 2/3", "step 3/3" as if they were
    // sequential steps of a single execution, instead of three
    // independent invocations (found via manual verification, ENG-763
    // stage 2).
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_1', tool_name: 'test_tool', content: 'step 1' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.progress', tool_use_id: 'tc_2', tool_name: 'test_tool', content: 'step 1' },
    ], initialStreamState(), now);

    expect(state.steps).toHaveLength(2);
    expect(state.steps[0]._scratchpadTabId).toBe('tc_1');
    expect(state.steps[1]._scratchpadTabId).toBe('tc_2');
    expect(state.steps[0]._scratchpadTabId).not.toBe(state.steps[1]._scratchpadTabId);
  });
});
