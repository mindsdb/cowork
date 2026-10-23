// The Stats switch belongs to the owner of a published artifact, on both
// deployments, and sits right after Comments.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn() },
}));
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

function renderHeader({ isPublished = true, canManage = true, stats } = {}) {
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

describe('Stats button', () => {
  it('is offered to the owner of a published artifact, right after Comments', () => {
    renderHeader();

    const comments = screen.getByRole('button', { name: 'Comments' });
    const stats = screen.getByRole('button', { name: 'Stats' });
    expect(comments.parentElement.nextElementSibling).toBe(stats);
  });

  it('is hidden on an unpublished artifact', () => {
    renderHeader({ isPublished: false });

    expect(screen.queryByRole('button', { name: 'Stats' })).toBeNull();
  });

  it('is hidden from someone who cannot manage the artifact', () => {
    renderHeader({ canManage: false });

    expect(screen.queryByRole('button', { name: 'Stats' })).toBeNull();
  });

  it('is hidden when the viewer passes no stats controller', () => {
    renderHeader({ stats: null });

    expect(screen.queryByRole('button', { name: 'Stats' })).toBeNull();
  });

  it('reads as a toggle and reports clicks', () => {
    const stats = renderHeader({ stats: { open: true, onToggle: vi.fn() } });

    const button = screen.getByRole('button', { name: 'Stats' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(stats.onToggle).toHaveBeenCalledTimes(1);
  });
});
