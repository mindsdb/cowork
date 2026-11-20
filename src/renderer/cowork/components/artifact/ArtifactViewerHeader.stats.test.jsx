// Stats left the header for the viewer's layer toggles (ENG-4455): the header
// keeps Share and no Stats button, even for the owner of a published artifact.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isMac: () => false,
    openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

function renderHeader({ isPublished = true, canManage = true } = {}) {
  render(
    <ArtifactViewerHeader
      title="Weather Dashboard"
      workspace={{
        supported: true,
        status: 'ready',
        mode: 'preview',
        setMode: vi.fn(),
        source: { path: 'index.html', content: '<h1>Hi</h1>' },
        capabilities: { role: 'owner', canEdit: true },
        unsupportedReason: '',
      }}
      review={{ enabled: true, open: false, controller: { unreadCount: 0 }, onToggle: vi.fn() }}
      publication={{
        canManage,
        publishable: true,
        controller: {
          publishedUrl: isPublished ? 'https://view.example/a/1' : '',
          setError: vi.fn(),
          loadVersions: vi.fn(),
        },
        hasActionPath: true,
        isPublished,
        disabledReason: '',
      }}
      actions={{
        canOpenInBrowser: false,
        canOpenInBrowserTab: false,
        canOpenLocalFile: false,
        isBackendArtifact: false,
        backendPort: null,
        artifact: { serveUrl: '' },
        deleteBusy: false,
        onReload: vi.fn(),
        onOpenInBrowser: vi.fn(),
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

describe('Stats in the header', () => {
  it('is not offered there to the owner of a published artifact', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stats' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
  });
});
