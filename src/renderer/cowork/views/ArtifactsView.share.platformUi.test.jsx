// The Artifacts page's Share opens the viewer on its own Share menu (ENG-4687),
// as the chat card does: one panel for every place an artifact is shared from.
// That panel's choices, errors and connection list are PublishMenu's tests.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
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
  getAccessToken: vi.fn(async () => null),
}));
const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => toast }));
const viewer = vi.hoisted(() => ({ props: [] }));
vi.mock('../components/artifact', () => ({
  ArtifactViewer: (props) => { viewer.props.push(props); return null; },
}));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';

const unpublished = {
  id: 'a1', path: '/proj/.anton/artifacts/share-test/index.html',
  title: 'share test', type: 'html-app', mtime: 2000,
  publishedUrl: '',
};
const lastViewer = () => viewer.props.at(-1);

afterEach(() => {
  localStorage.clear();
  viewer.props.length = 0;
  vi.clearAllMocks();
});

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view Share', (_name, view) => {
  it('opens the viewer on its Share menu, with no dialog of its own', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} />);
    fireEvent.click(screen.getByLabelText('Artifact menu'));
    fireEvent.click(screen.getByText('Share'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(lastViewer()).toMatchObject({ open: true, artifact: unpublished, shareEntry: 'list' });
    expect(lastViewer().shareRequest).toBeTruthy();
  });

  it('drops the Share request once the viewer closes', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} />);
    fireEvent.click(screen.getByLabelText('Artifact menu'));
    fireEvent.click(screen.getByText('Share'));
    act(() => lastViewer().onClose());
    expect(lastViewer().shareRequest).toBeNull();
    expect(lastViewer().shareEntry).toBe('viewer');
  });
});

it("shows a refused update's reason once", async () => {
  const REASON = 'Sharing an artifact with everyone in the organization needs the artifacts.share_org permission.';
  api.updateArtifact.mockRejectedValue(Object.assign(new Error(REASON), { status: 403, code: 'share_org_required' }));
  const published = { ...unpublished, publishedUrl: 'https://share/a1', accessMode: 'restricted', accessEmails: [], orgAllowed: true, ownerOnly: false, modified: true };
  render(<ArtifactsView artifacts={[published]} />);
  fireEvent.click(screen.getByLabelText('Artifact menu'));
  fireEvent.click(screen.getByText('Update'));

  await waitFor(() => expect(toast.add).toHaveBeenCalledWith({ title: REASON, type: 'danger' }));
});
