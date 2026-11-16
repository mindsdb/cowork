// An export from the viewer's header is one download in analytics: the export,
// with its format. Saving the exported file is not a second, file download.
// The header, export menu, export and download modules and the sharing
// analytics all run for real; only the network, the save transport and the
// analytics sink are mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  downloadAuthenticatedResource: vi.fn(async () => true),
  trackArtifactDownloaded: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isMac: () => false,
    openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('../../api', () => ({ authFetch: mocks.authFetch, BASE: 'https://cowork.example/api/v1' }));
vi.mock('../../lib/authenticatedResource', () => ({
  downloadAuthenticatedResource: mocks.downloadAuthenticatedResource,
}));
vi.mock('../../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackArtifactDownloaded: mocks.trackArtifactDownloaded,
}));
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

const ARTIFACT_ID = '7db94eb8f0a54c7e9c1d2b3a4f5e6d70';
const ARTIFACT = {
  id: ARTIFACT_ID,
  type: 'html',
  draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/notes.md`,
  serveUrl: '',
};

function renderHeader() {
  render(
    <ArtifactViewerHeader
      title="Notes"
      workspace={{
        supported: true,
        status: 'ready',
        mode: 'preview',
        setMode: vi.fn(),
        source: { path: 'notes.md', content: '# Notes' },
        capabilities: { role: 'owner', canEdit: true, exportFormats: ['html', 'docx'] },
        unsupportedReason: '',
      }}
      review={{ enabled: false, open: false, controller: { unreadCount: 0 }, onToggle: vi.fn() }}
      publication={{
        canManage: true,
        publishable: true,
        controller: { publishedUrl: '', setError: vi.fn(), loadVersions: vi.fn() },
        hasActionPath: true,
        isPublished: false,
        disabledReason: '',
      }}
      actions={{
        canOpenInBrowserTab: false,
        canOpenLocalFile: false,
        isBackendArtifact: false,
        backendPort: null,
        artifact: ARTIFACT,
        deleteBusy: false,
        onReload: vi.fn(),
        onOpenInBrowserTab: vi.fn(),
        onOpenFolder: vi.fn(),
        onOpenOS: vi.fn(),
        onDownload: vi.fn(),
        onTrash: vi.fn(),
      }}
      onClose={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe('exporting from the viewer header', () => {
  it('records one download: the export, with its format', async () => {
    mocks.authFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        filename: 'notes.docx',
        draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/notes.docx`,
        serveUrl: '/api/v1/artifacts/serve/proj/notes.docx',
        omittedCount: 0,
        scriptsDropped: false,
      }),
    });
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: /^Export/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Word' }));

    await waitFor(() => expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Export/ })).toBeEnabled());
    expect(mocks.trackArtifactDownloaded).toHaveBeenCalledTimes(1);
    expect(mocks.trackArtifactDownloaded).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: ARTIFACT_ID, artifactType: 'html', entry: 'viewer', kind: 'export', format: 'docx',
    }));
  });
});
