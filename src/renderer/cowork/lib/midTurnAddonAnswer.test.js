// A turn the person added a message to mid-task (ENG-4194) must end like any
// other: the final round's text is the answer, and Anton's narration before
// its tool calls (its opening line, and its acknowledgement of the added
// message) stays in the steps as Notes. The fixture is the event sequence a
// real anton ChatSession produced through cowork-server's formatter, on the
// hosted (pod) path and in-process (__fixtures__/mid_turn_addon_stream.json).
import { describe, it, expect, vi } from 'vitest';
import fixture from '../__fixtures__/mid_turn_addon_stream.json';
import { answerBody, initialStreamState, reduceStream, settleRound } from './responseStreamAdapter';
import { hydrateMessagesFromServerEvents } from './conversationHistory';
import { splitTurnSegments } from './turnSegments';

vi.mock('./analytics', () => ({ trackArtifactBuilt: vi.fn(), trackTokenCapHit: vi.fn() }));

const OPENING = 'Assuming “past week” means the last five completed trading sessions';
const ACK = 'Got it—using the last six calendar months instead.';
const FINAL = 'Updated the dashboard to cover the past six months.';

// Saved events, as a reload replays them: rows show from history alone.
const replay = (events) => events.reduce((s, ev) => reduceStream(s, ev, () => ev.at_ms, { replay: true }), initialStreamState());
const savedContent = (events) => events.at(-1).response.output[0].content[0].text;
const notes = (steps) => steps.filter((s) => s.badge === 'Note').map((s) => s.label);

describe.each([
  ['mid_turn_hosted'],
  ['mid_turn_in_process'],
])('a message read mid-task (%s)', (key) => {
  const events = fixture[key];

  it('answers with the final round only; the narration is Notes', () => {
    const state = settleRound(replay(events));
    const answer = answerBody(state).trim();
    expect(answer.startsWith(FINAL)).toBe(true);
    expect(answer).not.toContain(OPENING);
    expect(answer).not.toContain(ACK);
    const labels = notes(state.steps);
    expect(labels).toHaveLength(2);
    expect(labels[0].startsWith(OPENING)).toBe(true);
    expect(labels[1].startsWith(ACK)).toBe(true);
  });

  it('shows the added message between the two stretches of work, after the opening Note', () => {
    const state = replay(events);
    const segments = splitTurnSegments(state.steps, { startedAt: state.startedAt });
    expect(segments.map((s) => s.kind)).toEqual(['steps', 'addon', 'steps']);
    expect(segments[1].step.data).toMatchObject({ state: 'read', text: 'actually past 6 months' });
    expect(notes(segments[0].steps)[0].startsWith(OPENING)).toBe(true);
    expect(notes(segments[2].steps)[0].startsWith(ACK)).toBe(true);
  });

  it('reloads with the same answer, not the saved text that joins every round', () => {
    const content = savedContent(events);
    // What the server saves: every round, narration included.
    expect(content).toContain(OPENING);
    const [msg] = hydrateMessagesFromServerEvents([{ id: 'a1', role: 'assistant', content, events }]);
    expect(msg.content.trim().startsWith(FINAL)).toBe(true);
    expect(notes(msg.steps)).toHaveLength(2);
  });
});

describe('a message that arrives while the final answer is written (extra round)', () => {
  const events = fixture.after_final_answer_hosted;

  it('replaces the first answer and keeps the acknowledgement as a Note', () => {
    expect(events.some((e) => e.type === 'response.answer_reset')).toBe(true);
    const state = settleRound(replay(events));
    const answer = answerBody(state).trim();
    expect(answer.startsWith(FINAL)).toBe(true);
    expect(answer).not.toContain(ACK);
    expect(answer).not.toContain('Here is the past week dashboard');
    expect(notes(state.steps).some((l) => l.startsWith(ACK))).toBe(true);
  });

  it('reloads with the same answer', () => {
    const content = savedContent(events);
    const [msg] = hydrateMessagesFromServerEvents([{ id: 'a1', role: 'assistant', content, events }]);
    expect(msg.content.trim().startsWith(FINAL)).toBe(true);
  });
});
