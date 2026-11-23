// A change kept as a draft on a published artifact (ENG-4409): the header
// says the draft is ahead of the published page, with the card's own
// "Unshared changes" warning, until it is published. On every deployment, and
// a button opening the review of those changes when the viewer can show it
// (ENG-4595).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const orgMode = vi.hoisted(() => ({ on: false }));
vi.mock('../../../lib/orgMode', async (importOriginal) => ({
  ...(await importOriginal()),
  useOrgMode: () => orgMode.on,
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
vi.mock('./publish/PublishMenu', () => ({
  PublishMenu: () => <button type="button">Share</button>,
}));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

function renderHeader({ isPublished = true, modified = true, canManage = true, onReviewUnshared = null } = {}) {
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
      review={{ enabled: false, open: false, controller: { unreadCount: 0 }, onToggle: vi.fn() }}
      publication={{
        canManage,
        publishable: true,
        controller: {
          publishedUrl: isPublished ? 'https://view.example/a/1' : '',
          modified,
          setError: vi.fn(),
          loadVersions: vi.fn(),
        },
        hasActionPath: true,
        isPublished,
        disabledReason: '',
        onReviewUnshared,
      }}
      actions={{
        canOpenInBrowserTab: false,
        canOpenLocalFile: false,
        isBackendArtifact: false,
        backendPort: null,
        artifact: { serveUrl: '' },
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

describe('Unshared changes in the viewer header', () => {
  beforeEach(() => { orgMode.on = false; });

  it('shows when the published page is behind the draft', () => {
    renderHeader();
    expect(screen.getByText('Unshared changes')).toBeInTheDocument();
  });

  it('stays hidden when the published page is up to date', () => {
    renderHeader({ modified: false });
    expect(screen.queryByText('Unshared changes')).toBeNull();
  });

  it('stays hidden for a draft that was never published', () => {
    renderHeader({ isPublished: false });
    expect(screen.queryByText('Unshared changes')).toBeNull();
  });

  // A quick edit leaves a change unpublished there too, and Publish changes
  // now works there (ENG-4595).
  it('shows in MindsHub mode too', () => {
    orgMode.on = true;
    renderHeader();
    expect(screen.getByText('Unshared changes')).toBeInTheDocument();
  });

  it('is a plain warning when the viewer cannot show the changes', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /Unshared changes/ })).toBeNull();
  });

  it('opens the review of the changes when it can', () => {
    const onReviewUnshared = vi.fn();
    renderHeader({ onReviewUnshared });

    fireEvent.click(screen.getByRole('button', { name: /Unshared changes/ }));

    expect(onReviewUnshared).toHaveBeenCalledTimes(1);
  });
});
