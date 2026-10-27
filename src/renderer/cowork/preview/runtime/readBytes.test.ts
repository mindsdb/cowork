import { describe, expect, it } from 'vitest';

import { PREVIEW_PARENT_LIMITS } from '../limits';
import { readPreviewBytes } from './readBytes';

const MIB = 1024 * 1024;

/* A response whose body hands out `chunks` chunks of `size` bytes on demand,
   and records how many it handed out and whether the reader cancelled it. */
function streamedResponse(chunks: number, size = MIB) {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { response: new Response(body), state };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; name?: string };
  }
  throw new Error('expected the read to fail');
}

describe('readPreviewBytes', () => {
  it('reads the whole file into one buffer', async () => {
    const { response } = streamedResponse(3, 10);
    const bytes = await readPreviewBytes(response, 100, new AbortController().signal);
    expect(bytes.byteLength).toBe(30);
  });

  it(`stops at the ${PREVIEW_PARENT_LIMITS.maxBytes / MIB} MiB cap with too-large and cancels the rest`, async () => {
    const capChunks = PREVIEW_PARENT_LIMITS.maxBytes / MIB;
    const { response, state } = streamedResponse(capChunks * 4);

    const error = await failure(readPreviewBytes(response, PREVIEW_PARENT_LIMITS.maxBytes, new AbortController().signal));

    expect(error.code).toBe('too-large');
    expect(state.pulled).toBe(capChunks + 1);
    expect(state.cancelled).toBe(true);
  });

  it('reads a file of exactly the cap', async () => {
    const { response } = streamedResponse(4, 8);
    expect((await readPreviewBytes(response, 32, new AbortController().signal)).byteLength).toBe(32);
  });

  it('cancels the body when the preview closes mid-read', async () => {
    const controller = new AbortController();
    const { response, state } = streamedResponse(1000, 10);
    const reading = readPreviewBytes(response, 1_000_000, controller.signal);
    controller.abort();
    expect((await failure(reading)).name).toBe('AbortError');
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(1000);
  });

  it('cancels the body of a response that arrives after the preview closed', async () => {
    const controller = new AbortController();
    controller.abort();
    const { response, state } = streamedResponse(5, 10);
    expect((await failure(readPreviewBytes(response, 1000, controller.signal))).name).toBe('AbortError');
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBe(0);
  });
});
