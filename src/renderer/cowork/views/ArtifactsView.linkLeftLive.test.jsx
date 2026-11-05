/*
 * The Artifacts page's own Stop sharing, Update and Delete, and a delete from
 * the viewer it opens, say when Cowork left a shared link live (linkLeftLive.js)
 * instead of reporting the page as gone. The viewer closes once its card leaves
 * the page's list, so the page tells that delete's notice itself.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn((artifact) => artifact?.path),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: { isWeb: false, isMac: () => false, isElectron: true, openExternal: vi.fn(), getApiOrigin: () => 'https://cowork.example' },
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: toastAdd }) }));
const VIEWER_NOTICE = 'Cowork couldn’t take this page down, so anyone with its link can still open it: https://view.example/r/viewer.';
vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact, onDelete }) => (open
    ? <button onClick={() => onDelete?.(artifact.path, { notice: VIEWER_NOTICE })}>Viewer delete</button>
    : null),
}));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';
import { setOrgMode } from '../../lib/orgMode';

const LIVE_LINK = 'https://view.example/r/abc';
const shared = {
  id: 'a1', path: '/proj/.anton/artifacts/weather/index.html',
  title: 'Weather Dashboard', type: 'html-app', mtime: 2000, modified: true,
  publishedUrl: LIVE_LINK,
};
const LEFT_LIVE = { status: 'ok', takenDown: false, liveLink: LIVE_LINK, reason: 'no_owner_record' };
const TAKEN_DOWN = { status: 'ok', takenDown: true, liveLink: null, reason: null };

function choose(label) {
  fireEvent.click(screen.getByLabelText('Artifact menu'));
  fireEvent.click(screen.getByText(label));
}

function toastWith(title) {
  return expect.objectContaining({ title: expect.stringContaining(title) });
}

beforeEach(() => {
  localStorage.setItem('anton:artifacts-view', 'grid');
  setOrgMode(false);
  toastAdd.mockClear();
  api.deleteArtifact.mockResolvedValue(undefined);
});

afterEach(() => {
  localStorage.clear();
});

describe('the Artifacts page when Cowork leaves a shared link live', () => {
  it('Stop sharing says the link is still live, in a warning that stays', async () => {
    api.unpublishArtifact.mockResolvedValueOnce(LEFT_LIVE);
    render(<ArtifactsView artifacts={[shared]} />);
    choose('Stop sharing');
    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith({
      title: expect.stringContaining(LIVE_LINK), type: 'warning', timeout: 0,
    }));
    expect(toastAdd).not.toHaveBeenCalledWith(toastWith('Stopped sharing'));
  });

  it('Stop sharing that took the page down says so as before', async () => {
    api.unpublishArtifact.mockResolvedValueOnce(TAKEN_DOWN);
    render(<ArtifactsView artifacts={[shared]} />);
    choose('Stop sharing');
    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith({ title: expect.stringMatching(/^Stopped sharing/), type: 'success' }));
  });

  it('Update that shared a new link names the old one', async () => {
    api.updateArtifact.mockResolvedValueOnce({ status: 'ok', url: 'https://view.example/r/new', replacedLink: LIVE_LINK });
    render(<ArtifactsView artifacts={[shared]} />);
    choose('Update');
    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith(toastWith('still shows the earlier version')));
    expect(toastAdd).toHaveBeenCalledWith(toastWith(LIVE_LINK));
  });

  it('Delete says the link is still live instead of "Deleted."', async () => {
    api.unpublishArtifact.mockResolvedValueOnce(LEFT_LIVE);
    render(<ArtifactsView artifacts={[shared]} />);
    choose('Delete');
    await vi.waitFor(() => expect(api.deleteArtifact).toHaveBeenCalled());
    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith(toastWith(LIVE_LINK)));
    expect(toastAdd).not.toHaveBeenCalledWith(toastWith('Deleted.'));
  });

  it('a delete from the viewer tells its notice here', async () => {
    render(<ArtifactsView artifacts={[shared]} />);
    choose('Preview');
    fireEvent.click(await screen.findByText('Viewer delete'));
    expect(toastAdd).toHaveBeenCalledWith({ title: VIEWER_NOTICE, type: 'warning', timeout: 0 });
  });
});
