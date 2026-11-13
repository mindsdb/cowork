// The Artifacts page's own Share dialog, Stop sharing and Copy URL report
// through the same sharing events as the viewer's panel.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

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
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => toast }));
vi.mock('../components/artifact', () => ({ ArtifactViewer: () => null }));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../lib/clipboard', () => clipboard);
const report = vi.hoisted(() => ({
  reportShareOpened: vi.fn(),
  reportAccessChanged: vi.fn(),
  reportAccessChangeFailed: vi.fn(),
  reportLinkCopied: vi.fn(),
  reportWithdrawal: vi.fn(),
}));
vi.mock('../lib/artifactShareAnalytics', async (importOriginal) => ({ ...(await importOriginal()), ...report }));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';

const unpublished = {
  id: 'a1', path: '/proj/.anton/artifacts/share-test/index.html',
  title: 'share test', type: 'html-app', mtime: 2000, publishedUrl: '',
};
const published = { ...unpublished, publishedUrl: 'https://share/a1', accessMode: 'public' };

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function openMenuItem(name) {
  fireEvent.click(screen.getByLabelText('Artifact menu'));
  fireEvent.click(screen.getByText(name));
}

async function shareWithPeople(onArtifactChanged = vi.fn()) {
  render(<ArtifactsView artifacts={[unpublished]} onArtifactChanged={onArtifactChanged} />);
  openMenuItem('Share');
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('radio', { name: /Specific people/ }));
  const field = within(dialog).getByRole('combobox', { name: 'Add people by email' });
  fireEvent.change(field, { target: { value: 'ana@partner.io' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Share restricted' }));
}

describe('Artifacts page sharing analytics', () => {
  it('records opening the Share dialog', () => {
    render(<ArtifactsView artifacts={[unpublished]} />);
    openMenuItem('Share');

    expect(report.reportShareOpened).toHaveBeenCalledWith(unpublished, { entry: 'list', isShared: false });
  });

  it('records a share from the dialog as a first share', async () => {
    api.publishArtifact.mockResolvedValue({ url: 'https://share/a1', accessMode: 'restricted', result: { report_id: 'rep-1' } });
    await shareWithPeople();

    await waitFor(() => expect(report.reportAccessChanged).toHaveBeenCalledTimes(1));
    const [artifact, change] = report.reportAccessChanged.mock.calls[0];
    expect(artifact).toBe(unpublished);
    expect(change).toMatchObject({
      entry: 'list', reportId: 'rep-1',
      before: { shared: false, audience: 'unpublished' },
      after: { shared: true, audience: 'specific', peopleCount: 1 },
    });
  });

  it("keeps the card's page id current after a share", async () => {
    api.publishArtifact.mockResolvedValue({ url: 'https://share/a1', accessMode: 'restricted', result: { report_id: 'rep-1' } });
    const onArtifactChanged = vi.fn();
    await shareWithPeople(onArtifactChanged);
    await waitFor(() => expect(onArtifactChanged).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'rep-1' })));
  });

  it("clears the card's page id on Stop sharing", async () => {
    api.unpublishArtifact.mockResolvedValue({});
    const onArtifactChanged = vi.fn();
    render(<ArtifactsView artifacts={[{ ...published, reportId: 'rep-1' }]} onArtifactChanged={onArtifactChanged} />);
    openMenuItem('Stop sharing');
    await waitFor(() => expect(onArtifactChanged).toHaveBeenCalledWith(expect.objectContaining({ publishedUrl: '', reportId: '' })));
  });

  it('records a failed share as a failure only', async () => {
    api.publishArtifact.mockRejectedValue(new Error('network down'));
    await shareWithPeople();

    await waitFor(() => expect(report.reportAccessChangeFailed).toHaveBeenCalledWith(unpublished, { entry: 'list', reason: 'error' }));
    expect(report.reportAccessChanged).not.toHaveBeenCalled();
  });

  it('records Stop sharing as a pull-back', async () => {
    api.unpublishArtifact.mockResolvedValue({});
    render(<ArtifactsView artifacts={[published]} onArtifactChanged={vi.fn()} />);
    openMenuItem('Stop sharing');

    await waitFor(() => expect(report.reportWithdrawal).toHaveBeenCalledTimes(1));
    expect(report.reportWithdrawal.mock.calls[0][1]).toMatchObject({
      entry: 'list',
      before: { shared: true, audience: 'public' },
      leftLive: false,
    });
  });

  it('records a Stop sharing or delete that left the page live as a failed attempt', async () => {
    api.unpublishArtifact.mockResolvedValue({ status: 'ok', takenDown: false, liveLink: 'https://view.example/r/a', reason: 'no_owner_record' });
    api.deleteArtifact.mockResolvedValue(undefined);
    render(<ArtifactsView artifacts={[published]} onArtifactChanged={vi.fn()} />);
    openMenuItem('Stop sharing');
    await waitFor(() => expect(report.reportWithdrawal).toHaveBeenCalledTimes(1));
    expect(report.reportWithdrawal.mock.calls[0][1]).toMatchObject({ entry: 'list', leftLive: true });
  });

  it('records a delete that left the page live as left live', async () => {
    api.unpublishArtifact.mockResolvedValue({ status: 'ok', takenDown: false, liveLink: 'https://view.example/r/a', reason: 'no_owner_record' });
    api.deleteArtifact.mockResolvedValue(undefined);
    render(<ArtifactsView artifacts={[published]} onArtifactChanged={vi.fn()} />);
    openMenuItem('Delete');
    await waitFor(() => expect(report.reportWithdrawal).toHaveBeenCalledTimes(1));
    expect(report.reportWithdrawal.mock.calls[0][1]).toMatchObject({ entry: 'list_delete', leftLive: true });
  });

  it('records deleting a shared artifact as a pull-back from the delete', async () => {
    api.unpublishArtifact.mockResolvedValue({});
    api.deleteArtifact.mockResolvedValue(undefined);
    render(<ArtifactsView artifacts={[published]} onArtifactChanged={vi.fn()} />);
    openMenuItem('Delete');

    await waitFor(() => expect(report.reportWithdrawal).toHaveBeenCalledTimes(1));
    expect(report.reportWithdrawal.mock.calls[0][1]).toMatchObject({
      entry: 'list_delete', before: { shared: true }, leftLive: false,
    });
  });

  it('records a copied link only when the copy worked', async () => {
    // The list view's row menu offers Copy URL; the grid's card menu doesn't.
    localStorage.setItem('anton:artifacts-view', 'list');
    render(<ArtifactsView artifacts={[published]} />);

    clipboard.copyText.mockResolvedValueOnce(false);
    openMenuItem('Copy URL');
    await waitFor(() => expect(clipboard.copyText).toHaveBeenCalledTimes(1));
    expect(report.reportLinkCopied).not.toHaveBeenCalled();

    clipboard.copyText.mockResolvedValueOnce(true);
    openMenuItem('Copy URL');
    await waitFor(() => expect(report.reportLinkCopied).toHaveBeenCalledWith(published, { entry: 'list' }));
  });
});
