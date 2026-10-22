import { describe, expect, it } from 'vitest';

import {
  isPreviewToken,
  MAX_ERROR_DETAIL_LENGTH,
  newPreviewToken,
  readFrameReady,
  readFrameToParent,
  readParentPort,
  readParentToFrame,
} from './protocol';

const TOKEN = newPreviewToken();
const OTHER = newPreviewToken();

describe('preview tokens', () => {
  it('are 128 bits of lowercase hex, new each time', () => {
    expect(TOKEN).toMatch(/^[0-9a-f]{32}$/);
    expect(isPreviewToken(TOKEN)).toBe(true);
    expect(OTHER).not.toBe(TOKEN);
  });

  it.each([undefined, '', 'x', TOKEN.toUpperCase(), `${TOKEN}0`, 42])('rejects %s', (value) => {
    expect(isPreviewToken(value)).toBe(false);
  });
});

/* Each reader returns the typed message for this frame's token and null for
   anything else, so a side drops a message with a wrong or missing token. */
describe('message readers drop a wrong or missing token', () => {
  const summary = { type: 'xlsx', units: 2, truncated: false };
  const cases: Array<[string, (data: unknown, token: string) => unknown, Record<string, unknown>]> = [
    ['FrameReady', readFrameReady, { source: 'cowork-document-preview', type: 'ready' }],
    ['ParentPort', readParentPort, { type: 'port' }],
    ['document', readParentToFrame, { type: 'document', previewType: 'xlsx', bytes: new ArrayBuffer(1) }],
    ['asset reply', readParentToFrame, { type: 'asset', requestId: 1, name: 'a', bytes: null }],
    ['progress', readFrameToParent, { type: 'progress', done: 1, total: 2 }],
    ['rendered', readFrameToParent, { type: 'rendered', summary }],
    ['asset request', readFrameToParent, { type: 'asset-request', requestId: 1, name: 'a' }],
    ['error', readFrameToParent, { type: 'error', code: 'parse-failed' }],
  ];

  it.each(cases)('%s', (_label, read, message) => {
    expect(read({ ...message, token: TOKEN }, TOKEN)).toMatchObject(message);
    expect(read({ ...message, token: OTHER }, TOKEN)).toBeNull();
    expect(read(message, TOKEN)).toBeNull();
    expect(read({ ...message, token: '' }, TOKEN)).toBeNull();
  });
});

describe('message shapes', () => {
  it('drops a summary with a type outside the four, or units that are not a count', () => {
    for (const summary of [
      { type: 'html', units: 1, truncated: false },
      { type: 'toString', units: 1, truncated: false },
      { type: 'pdf', units: -1, truncated: false },
      { type: 'pdf', units: 1.5, truncated: false },
      { type: 'pdf', units: 1, truncated: 'no' },
    ]) {
      expect(readFrameToParent({ token: TOKEN, type: 'rendered', summary }, TOKEN)).toBeNull();
    }
  });

  it('drops an error code outside the contract, and caps the detail', () => {
    expect(readFrameToParent({ token: TOKEN, type: 'error', code: 'oops' }, TOKEN)).toBeNull();
    const message = readFrameToParent({ token: TOKEN, type: 'error', code: 'internal', detail: 'x'.repeat(5000) }, TOKEN);
    expect(message).toMatchObject({ code: 'internal' });
    expect(message?.type === 'error' && message.detail?.length).toBe(MAX_ERROR_DETAIL_LENGTH);
  });

  it('drops a document whose bytes are not an ArrayBuffer', () => {
    expect(readParentToFrame({ token: TOKEN, type: 'document', previewType: 'pdf', bytes: 'abc' }, TOKEN)).toBeNull();
  });

  it('keeps only the fields it knows', () => {
    expect(readFrameReady({ source: 'cowork-document-preview', type: 'ready', token: TOKEN, extra: 1 }, TOKEN))
      .toEqual({ source: 'cowork-document-preview', type: 'ready', token: TOKEN });
  });
});
