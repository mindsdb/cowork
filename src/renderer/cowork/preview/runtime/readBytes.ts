import { previewError } from '../errors';

/*
 * Reads a file response into one ArrayBuffer, counting bytes as they arrive.
 * The drafts route sends no Content-Length, so the count is the only size
 * check: past maxBytes it rejects with too-large. An abort of `signal`
 * rejects too, even one that came before the response did. Whenever it
 * rejects, it cancels the body, so the rest of the file never downloads.
 */
export async function readPreviewBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw previewError('too-large', `The file is larger than ${maxBytes} bytes.`);
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
