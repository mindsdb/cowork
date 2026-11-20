// The header opens its Share panel with the viewer when the viewer was opened
// by a Share clicked outside it.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
  PublishMenu: ({ openRequest, onRequestClosed }) => (
    <button type="button" data-open-request={String(!!openRequest)} onClick={onRequestClosed}>Share</button>
  ),
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

function renderHeader({ isPublished = true, canManage = true, shareRequest, onShareRequestClosed } = {}) {
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
        shareRequest,
        onShareRequestClosed,
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

describe('Share panel on open', () => {
  it('hands the menu the request, and its close back to the viewer', () => {
    const closed = vi.fn();
    renderHeader({ shareRequest: {}, onShareRequestClosed: closed });
    const share = screen.getByRole('button', { name: 'Share' });

    expect(share).toHaveAttribute('data-open-request', 'true');
    fireEvent.click(share);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('stays closed by default', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('data-open-request', 'false');
  });
});
