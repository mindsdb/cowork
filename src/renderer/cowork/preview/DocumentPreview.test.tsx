import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentPreviewData } from '../../../../tests/helpers/documentPreviewData';
import type { DocumentPreviewFrameProps } from './DocumentPreviewFrame';

const platform = vi.hoisted(() => ({ isWeb: true }));
/* The frame is a stub here: DocumentPreviewFrame has its own tests. */
const frameStub = vi.hoisted(() => ({
  crash: false,
  mounts: [] as Array<{ previewType: string; bytes: ArrayBuffer; onRendered: DocumentPreviewFrameProps['onRendered']; onError: DocumentPreviewFrameProps['onError'] }>,
}));

/* Each test's bundle script loader, which a test can make reject. */
const bundleStub = vi.hoisted(() => ({ loadScript: vi.fn<() => Promise<string>>() }));

vi.mock('../../platform/host', () => ({ host: platform }));
vi.mock('./generated/registry', () => ({
  previewBundles: ['xlsx', 'docx', 'pptx'].map((type) => ({
    type,
    scriptSha256: '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
    loadScript: () => bundleStub.loadScript(),
    loadAssets: null,
  })),
}));
vi.mock('./DocumentPreviewFrame', async () => {
  const { useEffect } = await import('react');
  return {
    DocumentPreviewFrame(props: DocumentPreviewFrameProps) {
      if (frameStub.crash) throw new Error('the preview crashed');
      useEffect(() => {
        frameStub.mounts.push(props);
      }, []);
      return <iframe title={props.title} className="document-preview-frame" />;
    },
  };
});

import {
  DocumentPreview,
  DOWNLOAD_FAILED_NOTE,
  PREVIEW_FAILED_DOWNLOADED_NOTE,
  PREVIEW_FAILED_NOTE,
  PREVIEW_FAILURE_REASONS,
  PREVIEW_LIMIT_REASONS,
  truncationLine,
  type DocumentPreviewProps,
  type DocumentPreviewSource,
} from './DocumentPreview';

const data = documentPreviewData();
const MIB = 1024 * 1024;
const SOURCE: DocumentPreviewSource = { url: 'http://localhost/api/v1/artifacts/drafts/local/a/report.xlsx?v=1.0', previewType: 'xlsx', filename: 'report.xlsx' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function bytesResponse(size = 3) {
  return new Response(new Uint8Array(size));
}

function mount(overrides: Partial<DocumentPreviewProps> = {}) {
  const props: DocumentPreviewProps = {
    source: SOURCE,
    fetchFile: vi.fn(async () => bytesResponse()),
    download: vi.fn(async () => true),
    openInDefaultApp: vi.fn(),
    onLoadError: vi.fn(),
    ...overrides,
  };
  const view = render(<DocumentPreview {...props} />);
  return { ...view, props };
}

async function mountedFrame() {
  await waitFor(() => expect(frameStub.mounts).toHaveLength(1));
  return frameStub.mounts[0];
}

beforeEach(() => {
  platform.isWeb = true;
  frameStub.crash = false;
  frameStub.mounts = [];
  bundleStub.loadScript.mockReset();
  bundleStub.loadScript.mockResolvedValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading a file', () => {
  it('fetches the source once and mounts the frame with its bytes and type', async () => {
    const { props } = mount();
    const frame = await mountedFrame();
    expect(props.fetchFile).toHaveBeenCalledTimes(1);
    expect(props.fetchFile).toHaveBeenCalledWith(SOURCE.url, expect.any(AbortSignal));
    expect(frame.previewType).toBe('xlsx');
    expect(frame.bytes.byteLength).toBe(3);
    expect(screen.getByTitle('Preview of report.xlsx')).toBeInTheDocument();
  });

  it('shows loading until the frame reports a render', async () => {
    mount();
    const frame = await mountedFrame();
    expect(screen.getByText('Loading preview…')).toBeInTheDocument();
    act(() => frame.onRendered({ type: 'xlsx', units: 2, truncated: false }));
    expect(screen.queryByText('Loading preview…')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('hands a failed fetch to the caller and previews nothing', async () => {
    const error = Object.assign(new Error('Could not load file (404)'), { status: 404 });
    const { props } = mount({ fetchFile: vi.fn(async () => { throw error; }) });
    await waitFor(() => expect(props.onLoadError).toHaveBeenCalledWith(error));
    expect(frameStub.mounts).toHaveLength(0);
    expect(props.download).not.toHaveBeenCalled();
  });

  it('stops a file over 32 MiB at the cap and names the byte limit', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(MIB));
      },
    }, { highWaterMark: 0 });
    mount({ fetchFile: vi.fn(async () => new Response(body)) });
    expect(await screen.findByText(PREVIEW_LIMIT_REASONS.maxBytes)).toBeInTheDocument();
    expect(pulled).toBe(33);
    expect(frameStub.mounts).toHaveLength(0);
  });

  it('fails as unsupported when the build has no bundle for the type', async () => {
    mount({ source: { ...SOURCE, previewType: 'pdf' } });
    expect(await screen.findByText(PREVIEW_FAILURE_REASONS.unsupported)).toBeInTheDocument();
  });

  it('fails as internal, and on web downloads the file, when the bundle does not load', async () => {
    bundleStub.loadScript.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    const { props } = mount();
    expect(await screen.findByText(PREVIEW_FAILURE_REASONS.internal)).toBeInTheDocument();
    await waitFor(() => expect(props.download).toHaveBeenCalledTimes(1));
    expect(props.onLoadError).not.toHaveBeenCalled();
    expect(frameStub.mounts).toHaveLength(0);
  });

  it('hands a failed fetch to the caller even when the bundle failed first', async () => {
    const error = new TypeError('Failed to fetch');
    bundleStub.loadScript.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    const fetchFile = vi.fn(() => new Promise<Response>((_, reject) => { setTimeout(() => reject(error), 0); }));
    const { props } = mount({ fetchFile });
    await waitFor(() => expect(props.onLoadError).toHaveBeenCalledWith(error));
    expect(bundleStub.loadScript).toHaveBeenCalledTimes(1);
    expect(props.download).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('closing or switching files', () => {
  it('aborts the read when the preview unmounts', async () => {
    const response = deferred<Response>();
    let signal: AbortSignal | undefined;
    const { unmount } = mount({ fetchFile: vi.fn((_url: string, abort: AbortSignal) => { signal = abort; return response.promise; }) });
    unmount();
    expect(signal?.aborted).toBe(true);

    let cancelled = false;
    response.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await waitFor(() => expect(cancelled).toBe(true));
    expect(frameStub.mounts).toHaveLength(0);
  });

  it('mounts a new frame for the next file', async () => {
    const { rerender, props } = mount();
    await mountedFrame();
    const next = { url: 'http://localhost/api/v1/artifacts/drafts/local/b/brief.docx?v=1.0', previewType: 'docx' as const, filename: 'brief.docx' };
    rerender(<DocumentPreview {...props} source={next} />);
    await waitFor(() => expect(frameStub.mounts).toHaveLength(2));
    expect(frameStub.mounts[1].previewType).toBe('docx');
    expect(props.fetchFile).toHaveBeenLastCalledWith(next.url, expect.any(AbortSignal));
    expect(screen.getAllByTitle(/^Preview of/)).toHaveLength(1);
  });
});

describe('a truncated render', () => {
  it.each(data.documentArtifacts.map((artifact) => artifact.type).filter((type) => type !== 'pdf'))('shows the %s truncation line in the body', async (type) => {
    mount({ source: { ...SOURCE, previewType: type } });
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type, units: 2, truncated: true }));
    expect(screen.getByRole('note')).toHaveTextContent(truncationLine(type, 2, true));
  });

  it('says how many slides a truncated deck drew, whichever cap ended it', async () => {
    expect(truncationLine('pptx', 300, true)).toBe('Showing the first 300 slides. Download has the full deck.');
    expect(truncationLine('pptx', 33, false)).toBe('Showing the first 33 slides. Open has the full deck.');
    expect(truncationLine('pptx', 1, true)).toBe('Showing the first slide. Download has the full deck.');
    mount({ source: { ...SOURCE, previewType: 'pptx' } });
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type: 'pptx', units: 33, truncated: true }));
    expect(screen.getByRole('note')).toHaveTextContent('Showing the first 33 slides. Download has the full deck.');
  });

  it('says Download has the full sheet on web and Open on desktop', async () => {
    expect(truncationLine('xlsx', 1, true)).toBe('Showing up to 2,000 rows and 200 columns of each sheet. Download has the full sheet.');
    expect(truncationLine('xlsx', 1, false)).toBe('Showing up to 2,000 rows and 200 columns of each sheet. Open has the full sheet.');
    platform.isWeb = false;
    const { props } = mount();
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type: 'xlsx', units: 1, truncated: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(props.openInDefaultApp).toHaveBeenCalledTimes(1);
  });

  it('says Download has the full sheet on desktop for a file that downloads there, and downloads from the bar', async () => {
    platform.isWeb = false;
    const { props } = mount({ fileAction: 'download' });
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type: 'xlsx', units: 1, truncated: true }));
    expect(screen.getByRole('note')).toHaveTextContent(truncationLine('xlsx', 1, true));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(props.download).toHaveBeenCalledTimes(1);
    expect(props.openInDefaultApp).not.toHaveBeenCalled();
  });

  async function truncatedOnWeb(download: DocumentPreviewProps['download']) {
    const view = mount({ download });
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type: 'xlsx', units: 1, truncated: true }));
    return view;
  }

  it('on web downloads the file from the bar and shows no message when the download succeeded', async () => {
    const { props } = await truncatedOnWeb(vi.fn(async () => true));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(props.download).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DOWNLOAD_FAILED_NOTE)).toBeNull();
  });

  it('on web says the download failed beside the button, keeps the frame, and clears the message on a retry that succeeds', async () => {
    const download = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await truncatedOnWeb(download);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(screen.getByRole('note')).toHaveTextContent(DOWNLOAD_FAILED_NOTE);
    expect(screen.getByTitle('Preview of report.xlsx')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(download).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(DOWNLOAD_FAILED_NOTE)).toBeNull();
  });

  it('on web drops the failed-download message while a retry is still downloading', async () => {
    const retry = deferred<boolean>();
    const download = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockReturnValueOnce(retry.promise);
    await truncatedOnWeb(download);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(screen.getByRole('note')).toHaveTextContent(DOWNLOAD_FAILED_NOTE);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(download).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(DOWNLOAD_FAILED_NOTE)).toBeNull();

    await act(async () => { retry.resolve(false); });
    expect(screen.getByRole('note')).toHaveTextContent(DOWNLOAD_FAILED_NOTE);
  });

  it('on web says the download failed when the download threw', async () => {
    await truncatedOnWeb(vi.fn(async () => { throw new Error('offline'); }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(screen.getByRole('note')).toHaveTextContent(DOWNLOAD_FAILED_NOTE);
    expect(screen.getByTitle('Preview of report.xlsx')).toBeInTheDocument();
  });
});

describe('a failed preview', () => {
  async function failWith(code: (typeof data.reasonCodes)[number], overrides: Partial<DocumentPreviewProps> = {}) {
    const view = mount(overrides);
    const frame = await mountedFrame();
    act(() => frame.onError({ code }));
    return view;
  }

  it('names a different reason for each code', () => {
    const reasons = data.reasonCodes.map((code) => PREVIEW_FAILURE_REASONS[code]);
    expect(reasons.every((reason) => reason.length > 0)).toBe(true);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it.each(data.reasonCodes)('shows the %s reason in the body', async (code) => {
    await failWith(code);
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_FAILURE_REASONS[code]);
    expect(screen.queryByTitle('Preview of report.xlsx')).toBeNull();
  });

  it('names a different reason for each limit', () => {
    const reasons = data.failureLimits.map(({ limit }) => PREVIEW_LIMIT_REASONS[limit]);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(data.failureLimits.map(({ limit }) => limit).sort()).toEqual(Object.keys(PREVIEW_LIMIT_REASONS).sort());
  });

  it.each(data.failureLimits)('names $limit and its value, $names, in place of the $code reason', async ({ limit, code, names }) => {
    const { props } = mount();
    const frame = await mountedFrame();
    act(() => frame.onError({ code, limit }));
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(PREVIEW_LIMIT_REASONS[limit]);
    expect(note).toHaveTextContent(names);
    expect(note).not.toHaveTextContent(PREVIEW_FAILURE_REASONS[code]);
    await waitFor(() => expect(props.download).toHaveBeenCalledTimes(1));
  });

  it('says too large to preview for a renderer past the Word element cap, never unsupported', async () => {
    const { props } = mount();
    const frame = await mountedFrame();
    act(() => frame.onError({ code: 'too-large', limit: 'maxDocxNodes' }));
    expect(screen.getByRole('status')).toHaveTextContent(/^Couldn't preview this file.*Too large to preview: /);
    expect(screen.getByRole('status')).not.toHaveTextContent(PREVIEW_FAILURE_REASONS.unsupported);
    await waitFor(() => expect(props.download).toHaveBeenCalledTimes(1));
  });

  it('on web downloads the file once and claims it only after the download succeeded', async () => {
    const download = deferred<boolean>();
    const { props } = await failWith('parse-failed', { download: vi.fn(() => download.promise) });
    expect(props.download).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_FAILED_NOTE);
    expect(screen.queryByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeNull();

    await act(async () => { download.resolve(true); });
    expect(screen.getByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(screen.getByText(PREVIEW_FAILURE_REASONS['parse-failed'])).toBeInTheDocument();
    expect(props.download).toHaveBeenCalledTimes(1);
  });

  it('on web claims no download when the download failed, and offers it again', async () => {
    const { props } = await failWith('timeout', { download: vi.fn(async () => false) });
    expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeNull();
    expect(screen.getByText(PREVIEW_FAILED_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.download).toHaveBeenCalledTimes(2);
  });

  it('on web claims no download when the download threw', async () => {
    await failWith('zip-limit', { download: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeNull();
  });

  it('on desktop says it could not preview, names the reason, and offers Open', async () => {
    platform.isWeb = false;
    const { props } = await failWith('unsupported');
    expect(props.download).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(`${PREVIEW_FAILED_NOTE}${PREVIEW_FAILURE_REASONS.unsupported}`);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(props.openInDefaultApp).toHaveBeenCalledTimes(1);
  });

  /* A desktop download can ask where to save, so a failed preview never
     opens that dialog on its own. */
  it('on desktop, for a file that downloads there, offers Download and downloads only on a click', async () => {
    platform.isWeb = false;
    const { props } = await failWith('unsupported', { fileAction: 'download' });
    expect(props.download).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByText(PREVIEW_FAILED_NOTE)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    expect(props.download).toHaveBeenCalledTimes(1);
    expect(screen.getByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(props.openInDefaultApp).not.toHaveBeenCalled();
  });

  /* The frame's draw watchdog reports timeout after rendered, naming
     progressTimeoutMs, when a page draw never ends. */
  it('replaces a rendered preview with the timeout note when the frame times out later, and downloads on web', async () => {
    const { props } = mount();
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type: 'xlsx', units: 1, truncated: false }));
    expect(screen.getByTitle('Preview of report.xlsx')).toBeInTheDocument();
    act(() => frame.onError({ code: 'timeout', limit: 'progressTimeoutMs' }));
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_LIMIT_REASONS.progressTimeoutMs);
    expect(screen.queryByTitle('Preview of report.xlsx')).toBeNull();
    await waitFor(() => expect(props.download).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
  });

  it('on desktop replaces a rendered preview with the timeout note and Open when the frame times out later', async () => {
    platform.isWeb = false;
    const { props } = mount();
    const frame = await mountedFrame();
    act(() => frame.onRendered({ type: 'xlsx', units: 1, truncated: false }));
    act(() => frame.onError({ code: 'timeout', limit: 'progressTimeoutMs' }));
    expect(screen.getByRole('status')).toHaveTextContent(`${PREVIEW_FAILED_NOTE}${PREVIEW_LIMIT_REASONS.progressTimeoutMs}`);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(props.openInDefaultApp).toHaveBeenCalledTimes(1);
    expect(props.download).not.toHaveBeenCalled();
  });

  it('shows the failure note, not a blank viewer, when the preview crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    frameStub.crash = true;
    const { props } = mount();
    expect(await screen.findByText(PREVIEW_FAILURE_REASONS.internal)).toBeInTheDocument();
    await waitFor(() => expect(props.download).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
  });
});

describe('layout', () => {
  it.each(['DocumentPreview.tsx', 'DocumentPreviewFrame.tsx'])('%s reads no window size and sets no inline style', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    for (const read of data.windowSizeReads) expect(source).not.toContain(read);
    expect(source).not.toMatch(/style=\{/);
  });

  it('fills its container through classes', () => {
    const { container } = mount();
    const root = container.firstElementChild!;
    expect(root.className).toBe('document-preview');
    expect(root.hasAttribute('style')).toBe(false);
    const css = readFileSync(join(__dirname, 'documentPreview.css'), 'utf8');
    expect(css).toMatch(/\.document-preview \{[^}]*position: absolute;[^}]*inset: 0;/);
    expect(css).toMatch(/\.document-preview-frame \{[^}]*width: 100%;/);
  });
});
