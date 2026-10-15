import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A Markdown artifact's own images, end to end through the viewer: the real
 * MarkdownContent, Edit's real split preview, and the real
 * fetchAuthenticatedBlob, so web's API-origin check runs too. Only authFetch,
 * the transport that adds the bearer on web, is stubbed, and the host flips
 * between an org web deployment and the desktop app on its loopback server.
 */
const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  host: { isWeb: true, isElectron: false, apiOrigin: 'https://cowork.example' },
}));

vi.mock('../../api', () => ({ authFetch: mocks.authFetch }));
vi.mock('../../../platform/host', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    host: {
      ...mod.host,
      openExternal: vi.fn(),
      get isWeb() { return mocks.host.isWeb; },
      get isElectron() { return mocks.host.isElectron; },
      getApiOrigin: () => mocks.host.apiOrigin,
      isLocalApiOrigin: () => mocks.host.isElectron,
    },
  };
});
vi.mock('../../lib/skillsStore', () => ({ useSkillNames: () => new Set() }));
vi.mock('./comments', () => ({
  CommentsPanel: () => null,
  CommentsToolbar: () => null,
}));
vi.mock('./workspace/ArtifactComparison', () => ({ ArtifactComparison: () => null }));
vi.mock('./workspace/TextSelectionComment', () => ({ TextSelectionComment: () => null }));

import { ArtifactViewerBody } from './ArtifactViewerBody';

const ORG_FOLDER = '/api/v1/artifacts/drafts/3f2b1c4e-0000-4000-8000-000000000001/9a8b7c6d5e4f40318a2b3c4d5e6f7a8b';
const LOCAL_FOLDER = '/api/v1/artifacts/drafts/local/9a8b7c6d5e4f40318a2b3c4d5e6f7a8b';

function png() {
  return { ok: true, status: 200, blob: async () => new Blob(['png'], { type: 'image/png' }) };
}

function renderBody({ mode = 'preview', text, folder = ORG_FOLDER, mtime = 1700, reloads = 0 }) {
  const workspace = {
    mode,
    source: { artifactId: 'artifact-1', path: 'report.md', contentType: 'md' },
    draft: text,
    setDraft: vi.fn(),
    save: vi.fn(),
    status: 'ready',
    capabilities: {},
    comparison: null,
    repair: null,
    setComparison: vi.fn(),
    restoreRevision: vi.fn(),
    decideRepair: vi.fn(),
    load: vi.fn(),
  };
  const preview = {
    draftUrl: `${folder}/report.md`,
    contentVersion: `${mtime}.${reloads}`,
    error: '',
    setError: vi.fn(),
    isText: true,
    loading: false,
    text: { content: text, truncated: false },
    textContentRef: { current: null },
    captureTextSelection: vi.fn(),
    textExtension: '.md',
    artifact: { path: '/artifacts/report.md', mtime },
    csv: null,
    onDownload: vi.fn(),
    onOpenOS: vi.fn(),
    url: '',
    kind: '',
    iframeRef: { current: null },
    title: 'Report',
    iframeReady: true,
    setIframeReady: vi.fn(),
    onReload: vi.fn(),
  };
  const review = {
    layer: { onIframeLoad: vi.fn(), anchorStates: {}, hlOn: vi.fn(), hlOff: vi.fn(), focus: vi.fn() },
    open: false,
    enabled: false,
    inboxOpen: false,
    setInboxOpen: vi.fn(),
    markersShown: true,
    setMarkersShown: vi.fn(),
    onToggle: vi.fn(),
    controller: { threads: [], setStatus: vi.fn() },
    textSelection: null,
    setTextSelection: vi.fn(),
  };
  return (
    <ArtifactViewerBody
      workspace={workspace}
      preview={preview}
      review={review}
      agentReview={{ busy: false, setBusy: vi.fn() }}
    />
  );
}

function requestedUrls() {
  return mocks.authFetch.mock.calls.map(([url]) => url);
}

describe('ArtifactViewerBody Markdown images', () => {
  beforeEach(() => {
    mocks.host.isWeb = true;
    mocks.host.isElectron = false;
    mocks.host.apiOrigin = 'https://cowork.example';
    mocks.authFetch.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:chart');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an image beside the report on org web, fetched with the bearer from the draft folder', async () => {
    mocks.authFetch.mockResolvedValue(png());
    render(renderBody({ text: '# Report\n\n![Revenue chart](chart.png)' }));

    const img = await screen.findByRole('img', { name: 'Revenue chart' });
    expect(img.getAttribute('src')).toBe('blob:chart');
    expect(requestedUrls()).toEqual([`https://cowork.example${ORG_FOLDER}/chart.png?v=1700.0`]);
  });

  it('shows the same image in the desktop app, from its loopback server', async () => {
    mocks.host.isWeb = false;
    mocks.host.isElectron = true;
    mocks.host.apiOrigin = 'http://127.0.0.1:26866';
    mocks.authFetch.mockResolvedValue(png());
    render(renderBody({ text: '![Revenue chart](chart.png)', folder: LOCAL_FOLDER }));

    expect((await screen.findByRole('img', { name: 'Revenue chart' })).getAttribute('src')).toBe('blob:chart');
    expect(requestedUrls()).toEqual([`http://127.0.0.1:26866${LOCAL_FOLDER}/chart.png?v=1700.0`]);
  });

  it('shows the image in Edit\'s split preview, from the request Preview already made', async () => {
    mocks.authFetch.mockResolvedValue(png());
    const text = '![Revenue chart](chart.png)';
    const { rerender } = render(renderBody({ text }));
    await screen.findByRole('img', { name: 'Revenue chart' });

    rerender(renderBody({ mode: 'edit', text }));

    // The source editor is lazy-loaded, so its preview mounts once the chunk resolves.
    const pane = await screen.findByRole('region', { name: 'Markdown preview' });
    await waitFor(() => expect(pane.querySelector('img')?.getAttribute('src')).toBe('blob:chart'));
    expect(mocks.authFetch).toHaveBeenCalledTimes(1);
  });

  it('loads an image from a subfolder of the artifact', async () => {
    mocks.authFetch.mockResolvedValue(png());
    render(renderBody({ text: '![Chart](img/chart.png)' }));

    await screen.findByRole('img', { name: 'Chart' });
    expect(requestedUrls()).toEqual([`https://cowork.example${ORG_FOLDER}/img/chart.png?v=1700.0`]);
  });

  it.each([
    ['a parent folder', '../other/secret.png'],
    ['an absolute path', '/etc/hosts.png'],
    ['a file: URL', 'file:///tmp/x.png'],
  ])('loads nothing for %s and shows the alt text', async (_label, src) => {
    const { container } = render(renderBody({ text: `![Secret](${src})` }));

    expect(await screen.findByRole('img', { name: 'Secret' })).toHaveTextContent('Secret');
    expect(container.querySelector('img')).toBeNull();
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it('shows a missing file\'s alt text and asks for it once while the text above it changes', async () => {
    mocks.authFetch.mockResolvedValue({ ok: false, status: 404 });
    const { rerender } = render(renderBody({ mode: 'edit', text: '![Missing chart](missing.png)' }));

    // The source editor is lazy-loaded, so its preview mounts once the chunk resolves.
    const pane = await screen.findByRole('region', { name: 'Markdown preview' });
    await waitFor(() => expect(pane).toHaveTextContent('Missing chart'));

    rerender(renderBody({ mode: 'edit', text: '# Added heading\n\n![Missing chart](missing.png)' }));
    rerender(renderBody({ mode: 'edit', text: '# Added heading\n\nA paragraph.\n\n![Missing chart](missing.png)' }));

    await waitFor(() => expect(pane).toHaveTextContent('Missing chart'));
    expect(pane.querySelector('img')).toBeNull();
    expect(mocks.authFetch).toHaveBeenCalledTimes(1);
  });

  it('asks again on Reload, so an image written after the first try shows', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValue(png());
    const text = '![Revenue chart](chart.png)';
    const { rerender } = render(renderBody({ text }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Revenue chart' })).toHaveTextContent('Revenue chart'));

    rerender(renderBody({ text, reloads: 1 }));

    await waitFor(() => expect(screen.getByRole('img', { name: 'Revenue chart' }).getAttribute('src')).toBe('blob:chart'));
    expect(requestedUrls()).toEqual([
      `https://cowork.example${ORG_FOLDER}/chart.png?v=1700.0`,
      `https://cowork.example${ORG_FOLDER}/chart.png?v=1700.1`,
    ]);
  });
});
