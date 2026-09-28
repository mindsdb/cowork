// ENG-2979: another member's artifact is tagged on the Live Artifacts page, in
// the grid card and in the list row, in the same row as the sharing status.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: false, openExternal: vi.fn() },
}));
vi.mock('../lib/analytics', () => ({
  trackArtifactPublished: vi.fn(),
}));
vi.mock('../components/ui/Toast', () => ({
  useToastManager: () => ({ add: vi.fn() }),
}));

import ArtifactsView from './ArtifactsView';

afterEach(() => localStorage.clear());

// Rendered in desktop mode (host.isWeb false, orgMode off) on purpose: the
// marker reads only `capabilities`, never the deployment. On a real desktop the
// server always sends role 'owner', which is why no tag shows there.
const card = (capabilities, overrides = {}) => ({
  id: 'a1',
  path: '/proj/.anton/artifacts/weather/index.html',
  title: 'Weather Dashboard',
  type: 'html-app',
  updated: 'updated 1h ago',
  mtime: 2000,
  capabilities,
  ...overrides,
});

const REVIEWER = { role: 'reviewer', canEdit: false };
const OWNERLESS = { role: 'reviewer', canEdit: false, ownerUnknown: true };
const OWNER = { role: 'owner', canEdit: true };
const PUBLISHED_MODIFIED = {
  publishedUrl: 'https://view.test/weather',
  accessMode: 'public',
  modified: true,
};

describe.each([
  ['grid card', () => {}],
  ['list row', () => localStorage.setItem('anton:artifacts-view', 'list')],
])('%s authorship tag', (_name, useView) => {
  it('tags another member\'s artifact', () => {
    useView();
    render(<ArtifactsView artifacts={[card(REVIEWER)]} />);
    expect(screen.getByText('Another member')).toBeInTheDocument();
  });

  it('tags an ownerless artifact', () => {
    useView();
    render(<ArtifactsView artifacts={[card(OWNERLESS)]} />);
    expect(screen.getByText('Unknown owner')).toBeInTheDocument();
    expect(screen.queryByText('Another member')).toBeNull();
  });

  it('does not tag the viewer\'s own artifact', () => {
    useView();
    render(<ArtifactsView artifacts={[card(OWNER)]} />);
    expect(screen.queryByText('Another member')).toBeNull();
    expect(screen.queryByText('Unknown owner')).toBeNull();
  });

  it('does not tag a card without capabilities', () => {
    useView();
    render(<ArtifactsView artifacts={[card(undefined)]} />);
    expect(screen.queryByText('Another member')).toBeNull();
  });

  it('keeps the tag in the status row of a published, modified artifact', () => {
    useView();
    render(<ArtifactsView artifacts={[card(REVIEWER, PUBLISHED_MODIFIED)]} />);
    const row = screen.getByText('Unshared changes').closest('.flex-wrap');
    expect(row).toContainElement(screen.getByText('Another member'));
    expect(row).toContainElement(screen.getByText('Public'));
  });
});
