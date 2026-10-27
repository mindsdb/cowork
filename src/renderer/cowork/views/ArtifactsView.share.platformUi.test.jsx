// The Artifacts page's Share dialog seeds its choice from the artifact, apart
// from the viewer's panel, so it gets its own check through the real page.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// A web build without the platform UI whose page has no SPA wrapper
// publish-token tag, which keeps the shared-token choices: no "Only you", and
// Public says "Anyone with the URL".
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn((a) => a.path),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: true, isMac: () => false, isElectron: false, openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));
vi.mock('../components/artifact', () => ({ ArtifactViewer: () => null }));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';

const unpublished = {
  id: 'a1', path: '/proj/.anton/artifacts/share-test/index.html',
  title: 'share test', type: 'html-app', mtime: 2000,
  publishedUrl: '',
};

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function openShareDialog() {
  fireEvent.click(screen.getByLabelText('Artifact menu'));
  fireEvent.click(screen.getByText('Share'));
  return screen.getByRole('dialog');
}

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view Share dialog with the platform UI off and no publish-token tag', (_name, view) => {
  it('opens with nothing picked and keeps Share disabled', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} />);
    const dialog = openShareDialog();

    for (const radio of within(dialog).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(within(dialog).queryByText('Only you')).toBeNull();
    const share = within(dialog).getByRole('button', { name: 'Share' });
    expect(share).toBeDisabled();
    fireEvent.click(share);
    expect(api.publishArtifact).not.toHaveBeenCalled();
  });

  it('opens with nothing picked even when an earlier publish left Public on it', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[{ ...unpublished, accessMode: 'public' }]} />);
    const dialog = openShareDialog();

    expect(within(dialog).getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
  });
});
