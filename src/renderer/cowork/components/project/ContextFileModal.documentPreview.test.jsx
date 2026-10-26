/* The file viewer's document branch: an uploaded or project .xlsx, .docx,
   .pptx or .pdf opens in the same read-only preview as an agent-made file of
   that type, and a file with no preview downloads with the artifact pages'
   note on web. The viewer, DocumentPreview and its frame are the real ones;
   the network, the shell and the renderer registry are not. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentPreviewData } from '../../../../../tests/helpers/documentPreviewData';
import { PREVIEW_FRAME_NAME } from '../../../../shared/document-preview';

const platform = vi.hoisted(() => ({
  isWeb: true,
  supportsDocumentPreview: true,
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
}));
const network = vi.hoisted(() => ({
  downloadAuthenticatedResource: vi.fn(),
  fetchAuthenticatedBlob: vi.fn(),
  fetchAuthenticatedResponse: vi.fn(),
}));

vi.mock('../../../platform/host', () => ({ host: platform }));
vi.mock('../../lib/authenticatedResource', () => network);
vi.mock('../markdown/MarkdownContent', () => ({ MarkdownContent: ({ text }) => <div data-markdown>{text}</div> }));
vi.mock('../../api', () => ({
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  mountProjectFilePreview: vi.fn(),
  projectFileDownloadUrl: (project, path) => `http://localhost/api/v1/projects/${project}/files-raw/${path}`,
  ANTON_PROJECT_INSTRUCTIONS_PATH: '.anton/anton.md',
}));
/* The viewer's size rides on the Modal's props. */
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, size, children }) => (open ? <div data-modal-size={size}>{children}</div> : null),
}));
/* The four renderers, as the bundle generator would list them. */
vi.mock('../../preview/kinds', async (importOriginal) => {
  const real = await importOriginal();
  return real.documentPreviewKinds(['xlsx', 'docx', 'pptx', 'pdf'].map((type) => `./renderers/${type}/render.ts`));
});
vi.mock('../../preview/generated/registry', () => ({
  previewBundles: ['xlsx', 'docx', 'pptx', 'pdf'].map((type) => ({
    type,
    scriptSha256: '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
    loadScript: async () => '',
    loadAssets: null,
  })),
}));

import { readProjectFile, writeProjectFile } from '../../api';
import { NO_PREVIEW_DOWNLOADED_NOTE } from '../../lib/artifactActions';
import { DOWNLOAD_FAILED_NOTE, PREVIEW_FAILED_DOWNLOADED_NOTE, PREVIEW_FAILURE_REASONS } from '../../preview/DocumentPreview';
import ContextFileModal from './ContextFileModal';

const data = documentPreviewData();
const MIB = 1024 * 1024;
const RAW = (name) => `http://localhost/api/v1/attachments/acme/task-1/${name}/raw`;
const PROJECT = (path) => `http://localhost/api/v1/projects/acme/files-raw/${path}`;

/* The two places a person opens a file they gave the agent, wired as the
   Context card wires them: a task upload by its raw URL, which reads text
   and offers no Edit, and a project file by its path. */
const SURFACES = [
  {
    surface: 'an uploaded',
    props: (name) => ({ title: name, filePath: name, rawUrl: RAW(name), showRawText: true, showEditAction: false }),
    url: RAW,
  },
  {
    surface: 'a project',
    props: (name) => ({ projectName: 'acme', projectPath: '/tmp/acme', filePath: `inputs/${name}` }),
    url: (name) => PROJECT(`inputs/${name}`),
  },
];
const FILES = { xlsx: 'plan.xlsx', docx: 'brief.docx', pptx: 'deck.pptx', pdf: 'rates.pdf' };

const previewFrames = () => [...document.querySelectorAll(`iframe[name="${PREVIEW_FRAME_NAME}"]`)];
const buttons = () => [...document.querySelectorAll('button')].map((button) => button.textContent.trim());
/* Bytes TextDecoder refuses, as a .zip's are. */
const binaryResponse = () => new Response(new Uint8Array([0x50, 0x4b, 0xff, 0xfe]));
/* A body past the preview's 32 MiB cap, served a MiB at a time. */
const oversizedResponse = () => new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(MIB)); },
}, { highWaterMark: 0 }));
const clickButton = (container, label) => fireEvent.click(
  within(container).getAllByRole('button').find((button) => button.textContent.trim().endsWith(label)),
);

function renderViewer(props) {
  return render(<ContextFileModal open onClose={vi.fn()} {...props} />);
}

beforeEach(() => {
  Object.assign(platform, { isWeb: true, supportsDocumentPreview: true });
  platform.openExternal.mockClear();
  platform.openPath.mockClear();
  network.downloadAuthenticatedResource.mockReset().mockResolvedValue(true);
  network.fetchAuthenticatedBlob.mockReset();
  network.fetchAuthenticatedResponse.mockReset().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.mocked(readProjectFile).mockReset();
  vi.mocked(writeProjectFile).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SURFACES)('$surface file', ({ props, url }) => {
  describe.each(Object.entries(FILES))('of type %s', (type, name) => {
    it('previews in one sandboxed srcdoc frame, named for the desktop guard, that never gets src', async () => {
      renderViewer(props(name));
      await waitFor(() => expect(previewFrames()).toHaveLength(1));
      const [iframe] = previewFrames();
      expect(document.querySelectorAll('iframe')).toHaveLength(1);
      expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
      expect(iframe.hasAttribute('src')).toBe(false);
      expect(iframe.getAttribute('srcdoc')).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
      for (const keyword of data.forbiddenSandboxKeywords) expect(iframe.getAttribute('sandbox')).not.toContain(keyword);
    });

    it('reads the file once from its own URL, with an abort signal, and reads no text or download', async () => {
      renderViewer(props(name));
      await waitFor(() => expect(previewFrames()).toHaveLength(1));
      expect(network.fetchAuthenticatedResponse).toHaveBeenCalledTimes(1);
      expect(network.fetchAuthenticatedResponse).toHaveBeenCalledWith(url(name), { signal: expect.any(AbortSignal) });
      expect(readProjectFile).not.toHaveBeenCalled();
      expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
    });

    it(`is a ${type} preview with the artifact viewer's room, a Download and no Edit`, async () => {
      renderViewer(props(name));
      await waitFor(() => expect(previewFrames()).toHaveLength(1));
      expect(document.querySelector('[data-modal-size]').dataset.modalSize).toBe('lg');
      expect(previewFrames()[0].getAttribute('title')).toBe(`Preview of ${props(name).title ?? `inputs/${name}`}`);
      expect(buttons().some((label) => label.endsWith('Download'))).toBe(true);
      expect(buttons()).not.toContain('Edit');
    });
  });

  it('removes the frame when the viewer closes', async () => {
    const view = renderViewer(props(FILES.xlsx));
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    view.rerender(<ContextFileModal open={false} onClose={vi.fn()} {...props(FILES.xlsx)} />);
    expect(previewFrames()).toHaveLength(0);
  });
});

describe('a file the preview cannot read', () => {
  it('says an upload is no longer attached when its read finds nothing', async () => {
    network.fetchAuthenticatedResponse.mockRejectedValue(Object.assign(new Error('Could not load file (404)'), { status: 404 }));
    renderViewer(SURFACES[0].props('plan.xlsx'));
    expect(await screen.findByText('plan.xlsx is no longer attached to this chat.')).toBeInTheDocument();
    expect(previewFrames()).toHaveLength(0);
    expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
  });

  it('says a project file is no longer in the project when its read finds nothing', async () => {
    network.fetchAuthenticatedResponse.mockRejectedValue(Object.assign(new Error('Could not load file (404)'), { status: 404 }));
    renderViewer(SURFACES[1].props('plan.xlsx'));
    expect(await screen.findByText('inputs/plan.xlsx is no longer in this project.')).toBeInTheDocument();
    expect(previewFrames()).toHaveLength(0);
  });
});

describe('on web, a file with no preview', () => {
  it('downloads an uploaded .zip once, then says so with the artifact pages\' note', async () => {
    network.fetchAuthenticatedResponse.mockImplementation(async () => binaryResponse());
    renderViewer(SURFACES[0].props('bundle.zip'));
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledTimes(1);
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(RAW('bundle.zip'), 'bundle.zip');
    expect(previewFrames()).toHaveLength(0);
  });

  it('downloads a project .zip the server refuses as text, under its basename', async () => {
    vi.mocked(readProjectFile).mockRejectedValue(new Error('HTTP 415 not valid UTF-8'));
    renderViewer(SURFACES[1].props('bundle.zip'));
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledTimes(1);
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(PROJECT('inputs/bundle.zip'), 'bundle.zip');
  });

  it('claims no download when the download failed, and keeps Download for another try', async () => {
    network.fetchAuthenticatedResponse.mockImplementation(async () => binaryResponse());
    network.downloadAuthenticatedResource.mockRejectedValue(Object.assign(new Error('Could not load file (401)'), { status: 401 }));
    renderViewer(SURFACES[0].props('bundle.zip'));
    expect(await screen.findByText(DOWNLOAD_FAILED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
    expect(buttons().filter((label) => label.endsWith('Download')).length).toBeGreaterThan(0);
  });

  it('downloads an .xlsx with the note where the shell has no document preview', async () => {
    platform.supportsDocumentPreview = false;
    network.fetchAuthenticatedResponse.mockImplementation(async () => binaryResponse());
    renderViewer(SURFACES[0].props('plan.xlsx'));
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(RAW('plan.xlsx'), 'plan.xlsx');
    expect(previewFrames()).toHaveLength(0);
  });

  it('downloads once per open: reopening the same file downloads it once more, not twice', async () => {
    network.fetchAuthenticatedResponse.mockImplementation(async () => binaryResponse());
    const view = renderViewer(SURFACES[0].props('bundle.zip'));
    await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE);
    view.rerender(<ContextFileModal open={false} onClose={vi.fn()} {...SURFACES[0].props('bundle.zip')} />);
    view.rerender(<ContextFileModal open onClose={vi.fn()} {...SURFACES[0].props('bundle.zip')} />);
    await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE);
    await act(async () => {});
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledTimes(2);
  });

  it('never downloads an image that failed to load: that is a failure, not a missing preview', async () => {
    network.fetchAuthenticatedBlob.mockRejectedValue(new Error('Could not load file (500)'));
    renderViewer(SURFACES[0].props('chart.png'));
    expect(await screen.findByText(/can't be displayed inline/)).toBeInTheDocument();
    expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
  });
});

/* A .csv past the 2 MiB inline cap is a type the viewer shows as text when it
   is smaller, so the note says the preview failed, not that the type has
   none. The server checks the size first, so a 413 may hold any bytes, and
   the file still downloads. */
describe('on web, a file too large to show as text', () => {
  it('downloads an upload past the cap once, with the preview\'s note', async () => {
    network.fetchAuthenticatedResponse.mockImplementation(async () => new Response('a'.repeat(3 * MIB)));
    renderViewer(SURFACES[0].props('stock.csv'));
    expect(await screen.findByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledTimes(1);
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(RAW('stock.csv'), 'stock.csv');
  });

  it('downloads an upload whose Content-Length is past the cap without reading its body', async () => {
    let pulled = false;
    const body = new ReadableStream({ pull() { pulled = true; } }, { highWaterMark: 0 });
    network.fetchAuthenticatedResponse.mockImplementation(async () => new Response(body, { headers: { 'Content-Length': String(3 * MIB) } }));
    renderViewer(SURFACES[0].props('stock.csv'));
    expect(await screen.findByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledTimes(1);
    expect(pulled).toBe(false);
  });

  it('downloads a project file the server refuses as too large, with the preview\'s note', async () => {
    vi.mocked(readProjectFile).mockRejectedValue(new Error('HTTP 413 File too large to read inline'));
    renderViewer(SURFACES[1].props('stock.csv'));
    expect(await screen.findByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledTimes(1);
    expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(PROJECT('inputs/stock.csv'), 'stock.csv');
  });
});

describe('an uploaded text file', () => {
  it('shows as text, with no Edit, no download and no preview', async () => {
    const text = 'sku,qty\nmug,250\n';
    network.fetchAuthenticatedResponse.mockImplementation(async () => new Response(text));
    renderViewer(SURFACES[0].props('stock.csv'));
    expect(await screen.findByText(/mug,250/)).toBeInTheDocument();
    expect(buttons()).not.toContain('Edit');
    expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
    expect(previewFrames()).toHaveLength(0);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });
});

describe('on desktop', () => {
  beforeEach(() => {
    platform.isWeb = false;
  });

  it('previews a project .xlsx, with Reveal and Open beside it', async () => {
    renderViewer(SURFACES[1].props('plan.xlsx'));
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    expect(buttons().some((label) => label.endsWith('Reveal'))).toBe(true);
    expect(buttons().some((label) => label.endsWith('Open'))).toBe(true);
  });

  it('leaves a project file with no preview in the panel, with Reveal and Open, and downloads nothing', async () => {
    vi.mocked(readProjectFile).mockRejectedValue(new Error('HTTP 415 not valid UTF-8'));
    renderViewer(SURFACES[1].props('bundle.zip'));
    expect(await screen.findByText(/can't be displayed inline/)).toBeInTheDocument();
    expect(buttons().some((label) => label.endsWith('Reveal'))).toBe(true);
    expect(buttons().some((label) => label.endsWith('Open'))).toBe(true);
    expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
  });

  /* An upload has no local file to open, and the OS browser that Open would
     hand its raw URL to carries no server token, so it gets a 401. It saves
     through the page's own fetch instead, on a click. */
  describe('an upload, which has no local file to open', () => {
    it('previews an .xlsx with Download beside it, not Open', async () => {
      renderViewer(SURFACES[0].props('plan.xlsx'));
      await waitFor(() => expect(previewFrames()).toHaveLength(1));
      expect(buttons().some((label) => label.endsWith('Download'))).toBe(true);
      expect(buttons().some((label) => label.endsWith('Open'))).toBe(false);
    });

    it('leaves a file with no preview in the panel, with Download, and downloads only on a click', async () => {
      network.fetchAuthenticatedResponse.mockImplementation(async () => binaryResponse());
      renderViewer(SURFACES[0].props('bundle.zip'));
      const panel = (await screen.findByText(/can't be displayed inline/)).closest('div.flex-1');
      expect(buttons().some((label) => label.endsWith('Open'))).toBe(false);
      expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
      clickButton(panel, 'Download');
      expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(RAW('bundle.zip'), 'bundle.zip');
      expect(platform.openExternal).not.toHaveBeenCalled();
    });

    it('offers Download, not Open, when the preview fails, and downloads only on a click', async () => {
      network.fetchAuthenticatedResponse.mockImplementation(async () => oversizedResponse());
      renderViewer(SURFACES[0].props('plan.xlsx'));
      const note = (await screen.findByText(PREVIEW_FAILURE_REASONS['too-large'])).closest('.document-preview-note');
      expect(within(note).queryByRole('button', { name: 'Open' })).toBeNull();
      expect(network.downloadAuthenticatedResource).not.toHaveBeenCalled();
      await act(async () => { clickButton(note, 'Download'); });
      expect(network.downloadAuthenticatedResource).toHaveBeenCalledWith(RAW('plan.xlsx'), 'plan.xlsx');
      expect(within(note).getByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
      expect(platform.openExternal).not.toHaveBeenCalled();
    });

    it('previews in a viewer without the open action, since a failed preview there downloads', async () => {
      renderViewer({ ...SURFACES[0].props('plan.xlsx'), showOpenAction: false });
      await waitFor(() => expect(previewFrames()).toHaveLength(1));
    });
  });

  /* A project file's failed preview offers Open, which hands the file to the
     OS default app; a viewer without the open action (a figure's source)
     keeps the panel instead. */
  it('keeps the panel for a project file in a viewer without the open action', async () => {
    vi.mocked(readProjectFile).mockRejectedValue(new Error('HTTP 415 not valid UTF-8'));
    renderViewer({ ...SURFACES[1].props('plan.xlsx'), showOpenAction: false });
    expect(await screen.findByText(/can't be displayed inline/)).toBeInTheDocument();
    expect(previewFrames()).toHaveLength(0);
  });
});

describe('a viewer without the open action, on web', () => {
  it('previews, since a failed preview there downloads instead of opening', async () => {
    renderViewer({ ...SURFACES[0].props('plan.xlsx'), showOpenAction: false });
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
  });
});
