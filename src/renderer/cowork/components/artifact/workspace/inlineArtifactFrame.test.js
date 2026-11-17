import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inlineHtmlFromApi } from '../../../lib/inlineHtmlAssets';
import {
  absoluteDraftUrl,
  inlineArtifactFrameDocument,
  useInlinedFrameDocument,
} from './inlineArtifactFrame';

vi.mock('../../../../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:4000' },
}));
vi.mock('../../../lib/inlineHtmlAssets', () => ({ inlineHtmlFromApi: vi.fn() }));

const DOC_URL = 'http://127.0.0.1:4000/api/v1/artifacts/drafts/p/a/index.html';
const HTML = '<html><head></head><body><img src="local.png"></body></html>';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  inlineHtmlFromApi.mockReset();
});

describe('absoluteDraftUrl', () => {
  it('prefixes an origin-relative draft URL with the API origin', () => {
    expect(absoluteDraftUrl('/api/v1/artifacts/drafts/p/a/index.html')).toBe(DOC_URL);
  });

  it('keeps an absolute URL', () => {
    expect(absoluteDraftUrl('http://other.test/x/index.html')).toBe('http://other.test/x/index.html');
  });

  it('returns an empty string for no URL', () => {
    expect(absoluteDraftUrl('')).toBe('');
    expect(absoluteDraftUrl(undefined)).toBe('');
  });
});

describe('inlineArtifactFrameDocument', () => {
  it('inlines from the document folder with the parameters Preview uses', async () => {
    inlineHtmlFromApi.mockResolvedValue('inlined');
    const controller = new AbortController();

    await expect(
      inlineArtifactFrameDocument(HTML, DOC_URL, { signal: controller.signal }),
    ).resolves.toBe('inlined');
    expect(inlineHtmlFromApi).toHaveBeenCalledWith(HTML, {
      rootUrl: 'http://127.0.0.1:4000/api/v1/artifacts/drafts/p/a/',
      filePath: 'index.html',
      signal: controller.signal,
      chatWorkspaces: false,
    });
  });

  it.each([
    ['an empty URL', ''],
    ['a data: URL', 'data:text/html,<p>x</p>'],
    ['a blob: URL', 'blob:http://127.0.0.1:4000/0b7c'],
    ['another origin', 'http://evil.test/api/v1/artifacts/drafts/p/a/index.html'],
  ])('returns the document unchanged for %s', async (_name, url) => {
    await expect(inlineArtifactFrameDocument(HTML, url)).resolves.toBe(HTML);
    expect(inlineHtmlFromApi).not.toHaveBeenCalled();
  });

  it('returns the document unchanged when the inliner throws', async () => {
    inlineHtmlFromApi.mockRejectedValue(new Error('boom'));
    await expect(inlineArtifactFrameDocument(HTML, DOC_URL)).resolves.toBe(HTML);
  });
});

describe('useInlinedFrameDocument', () => {
  it('returns the document in the same render when nothing can be inlined', () => {
    const { result } = renderHook(() => useInlinedFrameDocument(HTML, ''));
    expect(result.current).toEqual({ content: HTML, pending: false });
    expect(inlineHtmlFromApi).not.toHaveBeenCalled();
  });

  it('is pending until the inliner finishes', async () => {
    const read = deferred();
    inlineHtmlFromApi.mockReturnValue(read.promise);

    const { result } = renderHook(() => useInlinedFrameDocument(HTML, DOC_URL));
    expect(result.current).toEqual({ content: null, pending: true });

    await act(async () => { read.resolve('inlined'); });
    expect(result.current).toEqual({ content: 'inlined', pending: false });
  });

  it('never returns the previous document after the input changes', async () => {
    const first = deferred();
    const second = deferred();
    inlineHtmlFromApi
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ html }) => useInlinedFrameDocument(html, DOC_URL),
      { initialProps: { html: 'one' } },
    );
    await act(async () => { first.resolve('one inlined'); });
    expect(result.current.content).toBe('one inlined');

    rerender({ html: 'two' });
    expect(result.current).toEqual({ content: null, pending: true });

    await act(async () => { second.resolve('two inlined'); });
    expect(result.current).toEqual({ content: 'two inlined', pending: false });
  });

  it('cancels a run when the input changes and ignores its result', async () => {
    const first = deferred();
    const second = deferred();
    inlineHtmlFromApi
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ html }) => useInlinedFrameDocument(html, DOC_URL),
      { initialProps: { html: 'one' } },
    );
    const firstSignal = inlineHtmlFromApi.mock.calls[0][1].signal;

    rerender({ html: 'two' });
    expect(firstSignal.aborted).toBe(true);

    await act(async () => { first.resolve('one inlined'); });
    expect(result.current).toEqual({ content: null, pending: true });

    await act(async () => { second.resolve('two inlined'); });
    expect(result.current.content).toBe('two inlined');
  });

  it('cancels the run on unmount', () => {
    inlineHtmlFromApi.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useInlinedFrameDocument(HTML, DOC_URL));
    const { signal } = inlineHtmlFromApi.mock.calls[0][1];

    unmount();
    expect(signal.aborted).toBe(true);
  });
});
