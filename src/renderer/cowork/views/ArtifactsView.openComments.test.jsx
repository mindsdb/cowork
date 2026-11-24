// The Artifacts page shows how many comments are still open on each of the
// caller's own artifacts, and the count opens the preview on its Comments
// panel (ENG-4560).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ listCommentThreads: vi.fn() }));
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn(),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
  listCommentThreads: (...args) => api.listCommentThreads(...args),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));
const viewerProps = vi.hoisted(() => ({ calls: [] }));
vi.mock('../components/artifact', () => ({
  ArtifactViewer: (props) => {
    if (props.open) viewerProps.calls.push(props);
    return props.open
      ? (
        <div data-testid="artifact-viewer" data-comments={String(!!props.commentsRequest)}>
          Preview: {props.artifact.title}
          <button type="button" onClick={props.onClose}>Close viewer</button>
        </div>
      )
      : null;
  },
}));
vi.mock('../hooks/useOrgSharing', async (importOriginal) => ({
  ...(await importOriginal()),
  useSharingCapabilities: () => ({ capabilities: null }),
  useSharingOrgName: () => null,
  useMindsHubTeams: () => ({ status: 'ready', reachable: true, failure: null, teams: [] }),
  useKnownPeople: (ids) => ({ people: ids.map((id) => ({ id, name: null })) }),
}));

import ArtifactsView from './ArtifactsView';
import { resetOpenCommentCounts } from '../hooks/useOpenCommentCounts';

const hex = (n) => n.toString(16).padStart(32, '0');
const art = (n, title, extra = {}) => ({
  id: hex(n), path: `/proj/.anton/artifacts/${n}/index.html`, title, type: 'html-app', mtime: 2000,
  publishedUrl: '', capabilities: { role: 'owner', canEdit: true }, ...extra,
});
const ARTIFACTS = [
  art(1, 'Sales deck'),
  art(2, 'Their report', { capabilities: { role: 'reviewer', ownerUserId: 'u-bo' } }),
  art(3, 'Quiet page'),
];
const OPEN_BY_ID = {
  [hex(1)]: [{ id: 't1', status: 'open' }, { id: 't2', status: 'open' }, { id: 't3', status: 'open' }],
  [hex(2)]: [{ id: 't4', status: 'open' }],
  [hex(3)]: [],
};
const dashedToHex = (value) => value.replace(/-/g, '');

beforeEach(() => {
  viewerProps.calls = [];
  api.listCommentThreads.mockImplementation(async (_dir, reportId) => ({ threads: OPEN_BY_ID[dashedToHex(reportId)] || [] }));
});
afterEach(() => {
  localStorage.clear();
  resetOpenCommentCounts();
  api.listCommentThreads.mockReset();
});

describe.each(['list', 'grid'])('ArtifactsView open comments (%s)', (view) => {
  beforeEach(() => { localStorage.setItem('anton:artifacts-view', view); });

  it('counts open comments on the caller\'s own artifacts only, and none at zero', async () => {
    render(<ArtifactsView artifacts={ARTIFACTS} />);

    const counter = await screen.findByRole('button', { name: '3 open comments' });
    expect(counter).toHaveTextContent('3');
    expect(screen.getAllByTestId('open-comments')).toHaveLength(1);
    // Someone else's artifact is never read.
    expect(api.listCommentThreads).toHaveBeenCalledTimes(2);
    expect(api.listCommentThreads.mock.calls.map((call) => dashedToHex(call[1]))).not.toContain(hex(2));
  });

  it('opens the preview on its Comments panel, once, from the count', async () => {
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    fireEvent.click(await screen.findByRole('button', { name: '3 open comments' }));

    const viewer = screen.getByTestId('artifact-viewer');
    expect(viewer).toHaveTextContent('Preview: Sales deck');
    expect(viewer).toHaveAttribute('data-comments', 'true');
    // The row's own open did not run as well (it would ask for no comments).
    expect(viewerProps.calls.every((props) => !!props.commentsRequest)).toBe(true);
  });

  it('opens the preview as usual from the row, and reads the count again after a close', async () => {
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    await screen.findByRole('button', { name: '3 open comments' });
    fireEvent.click(screen.getByText('Sales deck'));
    expect(screen.getByTestId('artifact-viewer')).toHaveAttribute('data-comments', 'false');

    OPEN_BY_ID[hex(1)][0] = { id: 't1', status: 'resolved' };
    fireEvent.click(within(screen.getByTestId('artifact-viewer')).getByRole('button', { name: 'Close viewer' }));
    await screen.findByRole('button', { name: '2 open comments' });
    OPEN_BY_ID[hex(1)][0] = { id: 't1', status: 'open' };
  });
});

describe('ArtifactsView open comments, reads that fail', () => {
  it('draws no count when the read fails', async () => {
    localStorage.setItem('anton:artifacts-view', 'list');
    api.listCommentThreads.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(<ArtifactsView artifacts={ARTIFACTS} />);
    await waitFor(() => expect(api.listCommentThreads).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByTestId('open-comments')).toBeNull();
  });
});
