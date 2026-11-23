import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceStream, reduceAll } from './responseStreamAdapter';
import { hydrateMessagesFromServerEvents } from './conversationHistory';
import { splitTurnSegments } from './turnSegments';

// Anton's generate_image tool (ENG-4024) writes the picture into the workspace
// and returns its path; the server relays that result and the chat shows the
// file inline. These pin how the result becomes a step.

const RESULT = {
  path: 'images/cat.png',
  width: 1024,
  height: 1024,
  mime_type: 'image/png',
  model: 'gpt-image-2.6-flare',
  usage: { input_tokens: 16, output_tokens: 824 },
};
const result = (content = JSON.stringify(RESULT), over = {}) => ({
  type: 'response.in_progress',
  thought_role: 'thought.tool_call.result',
  tool_name: 'generate_image',
  tool_use_id: 'gi_1',
  content,
  at_ms: 20,
  ...over,
});
const progress = (text, at_ms) => ({
  type: 'response.in_progress',
  thought_role: 'thought.tool_call.progress',
  tool_use_id: 'gi_1',
  tool_name: 'generate_image',
  content: text,
  at_ms,
});

describe('responseStreamAdapter — generate_image result', () => {
  it('appends a completed Image step carrying the file, never the bytes', () => {
    const state = reduceAll([result()]);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({
      badge: 'Image',
      label: 'cat.png',
      status: 'completed',
      startedAt: 20,
      _toolUseId: 'gi_1',
      data: { path: 'images/cat.png', name: 'cat.png', width: 1024, height: 1024, mimeType: 'image/png', model: 'gpt-image-2.6-flare' },
    });
  });

  it('closes the progress row the tool was showing', () => {
    const state = reduceAll([progress('Generating an image', 10), result()]);
    const row = state.steps.find((s) => s.badge === 'ToolProgress');
    expect(row).toMatchObject({ status: 'completed', completedAt: 20 });
    expect(state.steps.at(-1).badge).toBe('Image');
  });

  it('shows nothing for a failed call or a result that names no image', () => {
    const before = initialStreamState();
    expect(reduceStream(before, result(JSON.stringify(RESULT), { ok: false }))).toBe(before);
    expect(reduceStream(before, result('Image generation was refused: moderation_blocked'))).toBe(before);
    expect(reduceStream(before, result(JSON.stringify({ error: 'rate_limited' })))).toBe(before);
  });

  it("ignores another tool's result on that role", () => {
    const before = initialStreamState();
    expect(reduceStream(before, result(JSON.stringify(RESULT), { tool_name: 'web_search' }))).toBe(before);
  });

  it('takes the result on the scratchpad result role too, without touching a running cell', () => {
    // A server with no branch of its own for the tool relays any tool result
    // there. Matched by tool name first, so it is not patched into the cell.
    const state = reduceAll([
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'sp_1', at_ms: 5 },
      result(JSON.stringify(RESULT), { thought_role: 'thought.scratchpad.result', tool_use_id: undefined }),
    ]);
    const cell = state.steps.find((s) => s._isScratchpad);
    expect(cell.status).toBe('in_progress');
    expect(cell.result ?? null).toBeNull();
    expect(state.steps.filter((s) => s.badge === 'Image')).toHaveLength(1);
  });

  it('adds one step per image, and none for a replayed duplicate', () => {
    const second = { ...RESULT, path: 'images/dog.png' };
    const state = reduceAll([result(), result(), result(JSON.stringify(second), { tool_use_id: 'gi_2' })]);
    expect(state.steps.map((s) => s.data.path)).toEqual(['images/cat.png', 'images/dog.png']);
  });

  it("reads each picture by the server's project-relative path, one step per image", () => {
    // Web/cloud: the tool's own path is the conversation folder's, and the
    // server maps each image into the project for the files route.
    const state = reduceAll([progress('Generating images', 10), result(JSON.stringify({ ...RESULT, path: 'cat.png' }), {
      generated_images: [{ path: 'conversations/conv-a/cat.png' }, { path: 'conversations/conv-a/cat-2.png' }],
    })]);
    const images = state.steps.filter((s) => s.badge === 'Image');
    expect(images.map((s) => s.data.path)).toEqual(['conversations/conv-a/cat.png', 'conversations/conv-a/cat-2.png']);
    expect(images.map((s) => s.label)).toEqual(['cat.png', 'cat-2.png']);
    expect(new Set(state.steps.map((s) => s.id)).size).toBe(state.steps.length);
    expect(images[0].data).toMatchObject({ width: 1024, height: 1024, model: 'gpt-image-2.6-flare' });
    expect(splitTurnSegments(state.steps).map((s) => s.kind)).toEqual(['steps', 'image', 'steps', 'image', 'steps']);
  });

  it('adds no image when the server maps none into the project', () => {
    const before = initialStreamState();
    expect(reduceStream(before, result(JSON.stringify(RESULT), { generated_images: [] }))).toBe(before);
  });

  it('dedupes a replayed multi-image event per image, without touching the held steps', () => {
    const event = result(JSON.stringify(RESULT), { generated_images: [{ path: 'a/1.png' }, { path: 'a/2.png' }] });
    const once = reduceAll([event]);
    const held = once.steps;
    expect(reduceStream(once, event)).toBe(once);
    expect(once.steps).toBe(held);
    expect(once.steps).toHaveLength(2);
  });

  it('splits the turn around the picture, so it renders where it was made', () => {
    const state = reduceAll([progress('Generating an image', 10), result()]);
    const kinds = splitTurnSegments(state.steps).map((s) => s.kind);
    expect(kinds).toEqual(['steps', 'image', 'steps']);
  });

  it('survives a reload from the events sidecar', () => {
    const [turn] = hydrateMessagesFromServerEvents([
      { role: 'assistant', content: 'Here it is.', events: [result(), { type: 'response.completed' }] },
    ]);
    expect(turn.steps.map((s) => s.badge)).toEqual(['Image']);
    expect(turn.steps[0].data.path).toBe('images/cat.png');
  });
});
