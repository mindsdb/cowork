import { describe, expect, it } from 'vitest';
import { localFileAttachments } from './localFileAttachments';

describe('localFileAttachments', () => {
  it('wraps each file for upload on send, with a unique id', () => {
    const a = new File(['x'], 'a.csv', { type: 'text/csv' });
    const b = new File(['yy'], 'b.bin');
    const [first, second] = localFileAttachments([a, b]);
    expect(first).toMatchObject({ source: 'file', pendingFile: a, name: 'a.csv', mime: 'text/csv', size: 1 });
    expect(second).toMatchObject({ pendingFile: b, name: 'b.bin', mime: undefined, size: 2 });
    expect(first.id).toMatch(/^local-/);
    expect(first.id).not.toBe(second.id);
  });

  it('is empty for no files', () => {
    expect(localFileAttachments(null)).toEqual([]);
  });
});
