/*
 * Closing the rail's artifact preview has to keep it closed.
 *
 * The viewer reports a publish refresh to its parent even when the response
 * lands after the modal closed, and this rail applied it unconditionally, which
 * re-opened the artifact the user had just dismissed. ChatView carried the same
 * defect and ChatView.artifactViewerClose.test.jsx proves the real viewer really
 * does fire that late, through the real publish hook. Here the viewer is a stub
 * that hands its props back, because what needs covering is this file's own
 * handler, not the viewer a second time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

const viewer = vi.hoisted(() => ({ props: null }));

vi.mock('../../api', () => ({
  fetchActiveProject: vi.fn(() => Promise.resolve(null)),
  fetchArtifacts: vi.fn(() => Promise.resolve([])),
  fetchProjects: vi.fn(() => Promise.resolve([])),
  unpublishArtifact: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isLocalApiOrigin: () => false,
    getApiOrigin: () => 'https://cowork.example',
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));
vi.mock('../artifact', () => ({
  ArtifactViewer: (props) => {
    viewer.props = props;
    return props.open ? <div data-testid="artifact-viewer">{props.artifact.title}</div> : null;
  },
}));
vi.mock('../../lib/artifactsStore', () => ({ deleteArtifactAndSync: vi.fn() }));
vi.mock('../../lib/artifactDownload', () => ({ downloadArtifactFile: vi.fn(async () => true) }));

import { WorkingFolderLive } from './WorkingFolderLive';
import { fetchArtifacts } from '../../api';
import { setOrgMode } from '../../../lib/orgMode';

const PROJECT = { id: 'proj-1', name: 'general', path: '/proj' };

const draft = (overrides = {}) => ({
  id: '11111111111111111111111111111111',
  title: 'Weekly Report',
  path: '/proj/.anton/artifacts/weekly/report.md',
  ext: '.md',
  type: 'report',
  mtime: 2000,
  updated: '3h ago',
  draftUrl: '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/report.md',
  publishedUrl: '',
  capabilities: { role: 'owner', canEdit: true },
  ...overrides,
});

const openPreview = async (...artifacts) => {
  fetchArtifacts.mockResolvedValue(artifacts);
  render(<WorkingFolderLive project={PROJECT} isStreaming={false} />);
  const row = await screen.findByText(artifacts[0].title);
  fireEvent.click(row);
  expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
};

// What the publish hook reports back: the same artifact carrying the access
// fields the server just answered with.
const refreshed = (artifact) => ({
  ...artifact,
  accessMode: 'restricted',
  accessEmails: ['someone@example.com'],
  publishedUrl: 'https://view.mindshub.ai/r/abc',
});

beforeEach(() => {
  viewer.props = null;
  setOrgMode(true);
});
afterEach(() => setOrgMode(false));

describe('artifacts rail preview, closing', () => {
  it('stays closed when a publish refresh lands after the user closed it', async () => {
    const artifact = draft();
    await openPreview(artifact);

    act(() => viewer.props.onClose());
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();

    act(() => viewer.props.onChange(refreshed(artifact)));

    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('still records the refreshed share state on the row behind the closed viewer', async () => {
    const artifact = draft();
    await openPreview(artifact);
    act(() => viewer.props.onClose());

    act(() => viewer.props.onChange(refreshed(artifact)));

    // The row is not the viewer: a closed preview does not make the share
    // state the server just reported stale, so it still has to land.
    fireEvent.click(screen.getByText('Weekly Report'));
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(viewer.props.artifact.publishedUrl).toBe('https://view.mindshub.ai/r/abc');
  });

  it('applies a refresh that lands while the viewer is still open', async () => {
    const artifact = draft();
    await openPreview(artifact);

    act(() => viewer.props.onChange(refreshed(artifact)));

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(viewer.props.artifact.accessMode).toBe('restricted');
  });

  it('does not swap the open artifact for one whose refresh lands late', async () => {
    const first = draft();
    const second = draft({
      id: '22222222222222222222222222222222',
      title: 'Ops Console',
      path: '/proj/.anton/artifacts/ops/index.md',
    });
    await openPreview(first, second);

    act(() => viewer.props.onClose());
    fireEvent.click(screen.getByText('Ops Console'));
    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent('Ops Console');

    act(() => viewer.props.onChange(refreshed(first)));

    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent('Ops Console');
  });
});
