// The shared document viewer (ENG-4687): it fetches the file published beside
// the page, hands it to the app's preview frame, and tells the page's CSS which
// to show: the preview, or the file's text when it can't.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';

const frame = vi.hoisted(() => ({ props: [] as Array<Record<string, any>> }));
vi.mock('../DocumentPreviewFrame', () => ({
  DocumentPreviewFrame: (props: Record<string, any>) => {
    frame.props.push(props);
    return <iframe title={props.title} data-testid="preview-frame" />;
  },
}));

import { mountDocumentViewer, VIEWER_STATE_ATTRIBUTE } from './mountDocumentViewer';

const bundle = { type: 'pptx' as const, scriptText: 'void 0', scriptSha256: 'x'.repeat(43) + '=', assets: null };
const state = () => document.documentElement.getAttribute(VIEWER_STATE_ATTRIBUTE);
const okFile = () => Promise.resolve(new Response(new Uint8Array([1, 2, 3])));

function mountElement(file: string, type = 'pptx') {
  const element = document.createElement('div');
  element.setAttribute('data-cowork-document', file);
  element.setAttribute('data-cowork-document-type', type);
  document.body.append(element);
  return element;
}

beforeEach(() => { frame.props.length = 0; });
afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(VIEWER_STATE_ATTRIBUTE);
});

describe('mountDocumentViewer', () => {
  it('fetches the file beside the page and mounts the preview frame with it', async () => {
    const fetchFile = vi.fn(okFile);
    const element = mountElement('Q3 deck.pptx');
    await act(() => mountDocumentViewer(element, { bundle, fetchFile }));

    expect(fetchFile).toHaveBeenCalledWith(new URL('Q3%20deck.pptx', document.baseURI).href, expect.any(AbortSignal));
    await waitFor(() => expect(element.querySelector('[data-testid="preview-frame"]')).not.toBeNull());
    const props = frame.props.at(-1)!;
    expect(props.previewType).toBe('pptx');
    expect(props.bundle).toBe(bundle);
    expect(new Uint8Array(props.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(state()).toBe('loading');
  });

  it('shows the preview once the frame rendered', async () => {
    const element = mountElement('deck.pptx');
    await act(() => mountDocumentViewer(element, { bundle, fetchFile: okFile }));
    await waitFor(() => expect(frame.props.length).toBeGreaterThan(0));
    act(() => frame.props.at(-1)!.onRendered({ type: 'pptx', units: 3, truncated: false }));
    expect(state()).toBe('rendered');
  });

  it('falls back to the text and removes the frame when it fails', async () => {
    const element = mountElement('deck.pptx');
    await act(() => mountDocumentViewer(element, { bundle, fetchFile: okFile }));
    await waitFor(() => expect(frame.props.length).toBeGreaterThan(0));
    act(() => frame.props.at(-1)!.onError({ code: 'parse-failed' }));
    expect(state()).toBe('failed');
    expect(element.querySelector('[data-testid="preview-frame"]')).toBeNull();
  });

  it('falls back to the text when the file does not answer', async () => {
    const element = mountElement('deck.pptx');
    await act(() => mountDocumentViewer(element, { bundle, fetchFile: () => Promise.resolve(new Response('', { status: 404 })) }));
    expect(state()).toBe('failed');
    expect(frame.props).toHaveLength(0);
  });

  it.each([
    ['a path', '../secret.pptx'],
    ['a folder', 'files/deck.pptx'],
    ['a hidden file', '.deck.pptx'],
    ['a URL', 'https://elsewhere.example/deck.pptx'],
    ['nothing', ''],
  ])('fetches nothing for %s', async (_name, file) => {
    const fetchFile = vi.fn(okFile);
    await act(() => mountDocumentViewer(mountElement(file), { bundle, fetchFile }));
    expect(fetchFile).not.toHaveBeenCalled();
    expect(state()).toBe('failed');
  });

  it("fetches nothing when the page names another type than the script's", async () => {
    const fetchFile = vi.fn(okFile);
    await act(() => mountDocumentViewer(mountElement('report.docx', 'docx'), { bundle, fetchFile }));
    expect(fetchFile).not.toHaveBeenCalled();
    expect(state()).toBe('failed');
  });
});
