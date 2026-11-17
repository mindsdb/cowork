// The header opens its Share panel with the viewer when the viewer was opened
// by a Share clicked outside it.
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
  PublishMenu: ({ openOnMount }) => <button type="button" data-open-on-mount={String(!!openOnMount)}>Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

function renderHeader({ isPublished = true, canManage = true, stats, openShare } = {}) {
  const statsProp = stats === undefined ? { open: false, onToggle: vi.fn() } : stats;
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
        openShare,
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
      stats={statsProp}
      onClose={vi.fn()}
    />,
  );
  return statsProp;
}

describe('Share panel on open', () => {
  it('opens with the viewer when asked', () => {
    renderHeader({ openShare: true });
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('data-open-on-mount', 'true');
  });

  it('stays closed by default', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('data-open-on-mount', 'false');
  });
});
