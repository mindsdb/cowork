/* The viewer's document branch for .xlsx, .docx, .pptx and .pdf files: the
   sandboxed frame, read-only tabs, comments off, and the failure notes. The
   header, body, workspace hook, DocumentPreview and its frame are the real
   ones; the network, the shell and the renderer registry are not. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentPreviewData } from '../../../../../tests/helpers/documentPreviewData';

/* The host members these tests reach. A desktop header with a folder to show
   calls isMac to label "Show in Finder". */
const platform = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  supportsDocumentPreview: true,
  isMac: () => true,
  getApiOrigin: () => 'http://localhost',
  isLocalApiOrigin: () => false,
  openExternal: vi.fn(),
  openPath: vi.fn(async () => ({ ok: true })),
}));
const calls = vi.hoisted(() => ({ comments: [], layer: [], diagnostics: [], body: [] }));
/* A published, restricted artifact with a comment key: comments would be on
   for any other file type. */
const publication = vi.hoisted(() => ({
  publishedUrl: 'https://example.com/p/report',
  accessMode: 'restricted',
  artifactKey: 'artifact/11111111-1111-4111-8111-111111111111',
  busy: false,
}));
const workspaceApi = vi.hoisted(() => ({
  loadArtifactSource: vi.fn(),
  loadArtifactReview: vi.fn(),
  enableDraftComments: vi.fn(),
  loadArtifactRevisions: vi.fn(),
}));

vi.mock('../../../platform/host', () => ({ host: platform }));
vi.mock('../../api', () => ({
  allocateConversationId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mountArtifactPreview: vi.fn(async () => ({ kind: 'static', url: 'http://localhost/preview' })),
  previewArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  artifactServeUrl: () => '',
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));
vi.mock('../../lib/authenticatedResource', () => ({ fetchAuthenticatedResponse: vi.fn() }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  canUseArtifactWorkspace: (artifact) => /^[0-9a-f]{32}$/.test(artifact?.id || ''),
  loadArtifactSource: workspaceApi.loadArtifactSource,
  loadArtifactReview: workspaceApi.loadArtifactReview,
  enableDraftComments: workspaceApi.enableDraftComments,
  loadArtifactRevisions: workspaceApi.loadArtifactRevisions,
  loadArtifactRevision: vi.fn(),
  loadAgentRepair: vi.fn(),
  cancelAgentRepair: vi.fn(),
  decideAgentRepair: vi.fn(),
  releaseAgentRepairs: vi.fn(),
  requestAgentRepair: vi.fn(),
  restoreArtifactRevision: vi.fn(),
  saveArtifactSource: vi.fn(),
  loadArtifactDraftText: vi.fn(),
  loadArtifactDraftDocument: vi.fn(),
}));
vi.mock('./publish/usePublish', () => ({ usePublish: () => publication }));
vi.mock('./publish/PublishMenu', () => ({ PublishMenu: () => null }));
vi.mock('./comments', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    useArtifactComments: (...args) => {
      calls.comments.push(args);
      return {
        threads: [], viewer: null, unreadCount: 0, capabilities: null,
        create: vi.fn(), reply: vi.fn(), setStatus: vi.fn(), editThread: vi.fn(),
        deleteThread: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn(), markRead: vi.fn(),
      };
    },
    useArtifactCommentLayer: (...args) => {
      calls.layer.push(args);
      return real.useArtifactCommentLayer(...args);
    },
  };
});
vi.mock('./usePreviewDiagnostics', async (importOriginal) => {
  const real = await importOriginal();
  return {
    usePreviewDiagnostics: (...args) => {
      calls.diagnostics.push(args);
      return real.usePreviewDiagnostics(...args);
    },
  };
});
vi.mock('./ArtifactViewerBody', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ArtifactViewerBody: (props) => {
      calls.body.push(props);
      return real.ArtifactViewerBody(props);
    },
  };
});
vi.mock('../ui/Modal', () => ({
  Modal: ({ open, children }) => (open ? <div>{children}</div> : null),
}));
vi.mock('../ConfirmModal', () => ({ ConfirmModal: () => null }));
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

import { mountArtifactPreview, previewArtifact } from '../../api';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { fetchAuthenticatedResponse } from '../../lib/authenticatedResource';
import { loadArtifactDraftDocument } from '../../lib/artifactWorkspaceApi';
import { PREVIEW_FAILED_DOWNLOADED_NOTE, PREVIEW_FAILED_NOTE, PREVIEW_LIMIT_REASONS } from '../../preview/DocumentPreview';
import { ArtifactViewer } from './ArtifactViewer';
import { PREVIEW_ONLY } from './workspace/useArtifactWorkspace';

const data = documentPreviewData();
const MIB = 1024 * 1024;

function cardFor({ id, title, path, draftUrl }) {
  return { id, title, path, file_path: path, canonicalPath: path, draftUrl, mtime: 1 };
}

function renderViewer(artifact, props = {}) {
  return render(<ArtifactViewer open artifact={artifact} onClose={vi.fn()} onChange={vi.fn()} onAddressWithAgent={vi.fn()} {...props} />);
}

const previewFrames = () => Array.from(document.querySelectorAll('iframe[name="cowork-document-preview"]'));
const tokenOf = (iframe) => iframe.getAttribute('srcdoc').match(/name="cowork-preview-token" content="([0-9a-f]{32})"/)[1];

function oversizedResponse() {
  return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(MIB)); } }, { highWaterMark: 0 }));
}

beforeEach(() => {
  Object.assign(platform, { isWeb: true, isElectron: false, supportsDocumentPreview: true, isLocalApiOrigin: () => false });
  for (const list of Object.values(calls)) list.length = 0;
  fetchAuthenticatedResponse.mockReset();
  fetchAuthenticatedResponse.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
  downloadArtifactFile.mockReset();
  downloadArtifactFile.mockImplementation(async () => true);
  mountArtifactPreview.mockClear();
  previewArtifact.mockClear();
  loadArtifactDraftDocument.mockReset();
  loadArtifactDraftDocument.mockResolvedValue({ isHtml: true, content: '<p>draft</p>' });
  platform.openPath.mockClear();
  /* A text sibling, which the server can send for a document artifact. */
  workspaceApi.loadArtifactSource.mockReset();
  workspaceApi.loadArtifactSource.mockResolvedValue({
    path: 'notes.md', content: '# notes', revision: { id: 'rev-1' }, capabilities: { role: 'owner', canEdit: true },
  });
  workspaceApi.loadArtifactReview.mockReset();
  workspaceApi.loadArtifactReview.mockResolvedValue({ capabilities: { role: 'owner', canEdit: true, canAddressWithAgent: true } });
  workspaceApi.enableDraftComments.mockReset();
  workspaceApi.enableDraftComments.mockResolvedValue({ enabled: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(data.documentArtifacts)('a $type artifact', (artifactData) => {
  const artifact = cardFor(artifactData);

  it('renders in one sandboxed, named srcdoc frame that never gets src', async () => {
    renderViewer(artifact);
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    const [iframe] = previewFrames();
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.hasAttribute('src')).toBe(false);
    expect(iframe.getAttribute('srcdoc')).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    for (const keyword of data.forbiddenSandboxKeywords) expect(iframe.getAttribute('sandbox')).not.toContain(keyword);
  });

  it('fetches the draft once, without download=1, and mounts nothing else', async () => {
    renderViewer(artifact);
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    expect(fetchAuthenticatedResponse).toHaveBeenCalledTimes(1);
    const [url] = fetchAuthenticatedResponse.mock.calls[0];
    expect(url.startsWith(`http://localhost${artifactData.draftUrl}?`)).toBe(true);
    expect(url).not.toContain('download=1');
    expect(mountArtifactPreview).not.toHaveBeenCalled();
    expect(loadArtifactDraftDocument).not.toHaveBeenCalled();
    expect(previewArtifact).not.toHaveBeenCalled();
    for (const request of Object.values(workspaceApi)) expect(request).not.toHaveBeenCalled();
  });

  it('keeps the comment layer, comments and preview diagnostics off', async () => {
    renderViewer(artifact);
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /^Comments/ })).toBeNull();
    expect(calls.layer.length).toBeGreaterThan(0);
    expect(calls.layer.every(([, options]) => options.enabled === false)).toBe(true);
    expect(calls.comments.every(([, , options]) => options.enabled === false)).toBe(true);
    expect(calls.diagnostics.every(([, options]) => options.enabled === false)).toBe(true);
    const { preview, review } = calls.body.at(-1);
    expect(preview.url).toBe('');
    expect(preview.doc).toBe('');
    expect(review.enabled).toBe(false);
  });

  it(`disables Edit and Review with "${PREVIEW_ONLY}", even with a text sibling to load`, async () => {
    renderViewer(artifact);
    const edit = await screen.findByRole('tab', { name: `Edit unavailable \u2014 ${PREVIEW_ONLY}` });
    const review = screen.getByRole('tab', { name: `Review unavailable \u2014 ${PREVIEW_ONLY}` });
    expect(edit).toBeDisabled();
    expect(review).toBeDisabled();
    expect(workspaceApi.loadArtifactSource).not.toHaveBeenCalled();
    expect(calls.body.at(-1).workspace.source).toBeNull();
  });

  it('offers no "Address with agent"', async () => {
    renderViewer(artifact);
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    expect(calls.body.at(-1).review.onAddressWithAgent).toBeUndefined();
    expect(screen.queryByText('Address with agent')).toBeNull();
  });
});

describe('the document branch', () => {
  const [xlsx, docx] = data.documentArtifacts.map(cardFor);

  it('never mounts where the shell does not support document previews', async () => {
    Object.assign(platform, { isWeb: false, isElectron: true, supportsDocumentPreview: false });
    renderViewer(xlsx);
    await waitFor(() => expect(loadArtifactDraftDocument).toHaveBeenCalled());
    expect(previewFrames()).toHaveLength(0);
    expect(fetchAuthenticatedResponse).not.toHaveBeenCalled();
  });

  it('removes the frame on close, and gives the next file a new frame and token', async () => {
    const view = renderViewer(xlsx);
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    const firstToken = tokenOf(previewFrames()[0]);

    view.rerender(<ArtifactViewer open artifact={docx} onClose={vi.fn()} onChange={vi.fn()} />);
    await waitFor(() => expect(fetchAuthenticatedResponse).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(previewFrames()).toHaveLength(1));
    expect(tokenOf(previewFrames()[0])).not.toBe(firstToken);
    expect(fetchAuthenticatedResponse.mock.calls[1][0]).toContain(docx.draftUrl);

    view.rerender(<ArtifactViewer open={false} artifact={docx} onClose={vi.fn()} onChange={vi.fn()} />);
    expect(previewFrames()).toHaveLength(0);
  });

  it('aborts the draft request still in flight on a file switch and on close', async () => {
    fetchAuthenticatedResponse.mockImplementation(() => new Promise(() => undefined));
    const view = renderViewer(xlsx);
    await waitFor(() => expect(fetchAuthenticatedResponse).toHaveBeenCalledTimes(1));
    const [firstUrl, firstOptions] = fetchAuthenticatedResponse.mock.calls[0];
    expect(firstUrl).toContain(xlsx.draftUrl);
    expect(firstOptions).toEqual({ signal: expect.any(AbortSignal) });
    expect(firstOptions.signal.aborted).toBe(false);

    view.rerender(<ArtifactViewer open artifact={docx} onClose={vi.fn()} onChange={vi.fn()} />);
    await waitFor(() => expect(fetchAuthenticatedResponse).toHaveBeenCalledTimes(2));
    expect(firstOptions.signal.aborted).toBe(true);
    const [nextUrl, nextOptions] = fetchAuthenticatedResponse.mock.calls[1];
    expect(nextUrl).toContain(docx.draftUrl);
    expect(nextOptions.signal.aborted).toBe(false);

    view.rerender(<ArtifactViewer open={false} artifact={docx} onClose={vi.fn()} onChange={vi.fn()} />);
    expect(nextOptions.signal.aborted).toBe(true);
  });

  it('on web downloads a file it cannot preview and says so after the download succeeded', async () => {
    fetchAuthenticatedResponse.mockImplementation(async () => oversizedResponse());
    renderViewer(xlsx);
    expect(await screen.findByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeInTheDocument();
    expect(screen.getByText(PREVIEW_LIMIT_REASONS.maxBytes)).toBeInTheDocument();
    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(downloadArtifactFile).toHaveBeenCalledWith(xlsx, { actionPath: xlsx.canonicalPath });
    expect(previewFrames()).toHaveLength(0);
  });

  it('on web claims no download when the download failed', async () => {
    fetchAuthenticatedResponse.mockImplementation(async () => oversizedResponse());
    downloadArtifactFile.mockImplementation(async () => false);
    renderViewer(xlsx);
    expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByText(PREVIEW_FAILED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(PREVIEW_FAILED_DOWNLOADED_NOTE)).toBeNull();
  });

  it('on desktop says it could not preview, names the reason, and opens the file with Open', async () => {
    Object.assign(platform, { isWeb: false, isElectron: true, supportsDocumentPreview: true, isLocalApiOrigin: () => true });
    fetchAuthenticatedResponse.mockImplementation(async () => oversizedResponse());
    renderViewer(xlsx);
    expect(await screen.findByText(PREVIEW_LIMIT_REASONS.maxBytes)).toBeInTheDocument();
    expect(screen.getByText(PREVIEW_FAILED_NOTE)).toBeInTheDocument();
    expect(downloadArtifactFile).not.toHaveBeenCalled();
    /* The note's own Open, not the header's desktop Open beside it. */
    const note = screen.getByText(PREVIEW_FAILED_NOTE).closest('[role="status"]');
    await act(async () => { fireEvent.click(within(note).getByRole('button', { name: 'Open' })); });
    expect(platform.openPath).toHaveBeenCalledWith(xlsx.canonicalPath);
  });

  it('shows why a draft could not be fetched', async () => {
    fetchAuthenticatedResponse.mockRejectedValue(Object.assign(new Error('Could not load file (403)'), { status: 403 }));
    renderViewer(xlsx);
    expect(await screen.findByText('You do not have access to this draft.')).toBeInTheDocument();
    expect(downloadArtifactFile).not.toHaveBeenCalled();
  });
});

describe('the other previews', () => {
  it('keep the HTML frame sandbox exactly as it was', () => {
    const body = readFileSync(join(__dirname, 'ArtifactViewerBody.jsx'), 'utf8');
    expect(body).toContain([
      "          sandbox={previewKind === 'proxy'",
      "            ? 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals'",
      "            : 'allow-scripts allow-popups allow-forms allow-modals'}",
    ].join('\n'));
  });

  it('send an HTML draft down its own branch, with comments on, not the document frame', async () => {
    renderViewer({
      id: '55555555555545558555555555555555', title: 'Dashboard', ext: '.html', path: '/artifacts/d/index.html',
      draftUrl: '/api/v1/artifacts/drafts/local/55555555555545558555555555555555/index.html', mtime: 1,
    });
    await waitFor(() => expect(loadArtifactDraftDocument).toHaveBeenCalled());
    expect(previewFrames()).toHaveLength(0);
    expect(fetchAuthenticatedResponse).not.toHaveBeenCalled();
    expect(calls.comments.at(-1)[2].enabled).toBe(true);
    expect(screen.getByRole('button', { name: /^Comments/ })).toBeInTheDocument();
  });
});
