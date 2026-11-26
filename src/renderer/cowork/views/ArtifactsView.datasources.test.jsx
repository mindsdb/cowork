import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../hooks/useOrgSharing', async (importOriginal) => ({
  ...(await importOriginal()),
  useSharingCapabilities: () => ({ status: 'ready', capabilities: null, retry: () => {} }),
}));
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  fetchPendingDatasources: vi.fn(),
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

import ArtifactsView from './ArtifactsView';
import { setOrgMode } from '../../lib/orgMode';
import * as api from '../api';

const PENDING = [{ engine: 'postgres', name: 'scm', label: 'postgres/scm' }];
const CHANGED = [...PENDING, { engine: 'mysql', name: 'late', label: 'mysql/late' }];
const app = {
  id: 'a1', path: '/proj/.anton/artifacts/planner/index.html', title: 'Planner',
  type: 'fullstack-stateless-app', mtime: 2000, publishedUrl: '',
};
const approvalError = (pending) => Object.assign(new Error('m'), {
  status: 409, code: 'datasource_approval_required', body: { detail: { pending } },
});

function openMenuItem(name) {
  fireEvent.click(screen.getByLabelText('Artifact menu'));
  fireEvent.click(screen.getByText(name));
}

// Picks Public explicitly so the test does not depend on the dialog's default selection.
function shareFrom(dialog) {
  fireEvent.click(within(dialog).getByRole('radio', { name: /Public/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setOrgMode(false);
});

describe('connection approval on the Artifacts page', () => {
  it('lists the connections in the publish dialog and approves them on Share', async () => {
    api.fetchPendingDatasources.mockResolvedValue(PENDING);
    api.publishArtifact.mockResolvedValue({ url: 'https://share/a1', accessMode: 'restricted' });
    render(<ArtifactsView artifacts={[app]} />);
    openMenuItem('Share');
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/postgres\/scm/)).toBeTruthy();
    shareFrom(dialog);
    await waitFor(() => expect(api.publishArtifact).toHaveBeenCalledWith(
      app.path, expect.anything(), { approvedDatasources: PENDING },
    ));
  });

  it('reopens the dialog with the new list on a 409', async () => {
    api.fetchPendingDatasources.mockResolvedValueOnce(PENDING).mockResolvedValue(CHANGED);
    api.publishArtifact.mockRejectedValueOnce(approvalError(CHANGED));
    render(<ArtifactsView artifacts={[app]} />);
    openMenuItem('Share');
    const first = screen.getByRole('dialog');
    await within(first).findByText(/postgres\/scm/);
    shareFrom(first);
    const again = await screen.findByRole('dialog');
    expect(await within(again).findByText(/mysql\/late/)).toBeTruthy();
    // The reopened dialog explains it; no toast sends the person to Share.
    expect(toast.add).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
  });

  it('keeps the chosen access and the 409 list when the dialog reopens, and publishes them', async () => {
    api.fetchPendingDatasources.mockResolvedValueOnce(PENDING).mockReturnValue(new Promise(() => {}));
    api.publishArtifact
      .mockRejectedValueOnce(approvalError(CHANGED))
      .mockResolvedValueOnce({ url: 'https://share/a1', accessMode: 'public' });
    render(<ArtifactsView artifacts={[app]} />);
    openMenuItem('Share');
    const first = screen.getByRole('dialog');
    await within(first).findByText(/postgres\/scm/);
    shareFrom(first);
    const again = await screen.findByRole('dialog');
    // The re-fetch never answers, so the list can only come from the 409 body.
    expect(within(again).getByText(/mysql\/late/)).toBeTruthy();
    expect(within(again).getByRole('radio', { name: /Public/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(again).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(api.publishArtifact).toHaveBeenCalledTimes(2));
    expect(api.publishArtifact).toHaveBeenLastCalledWith(
      app.path, expect.objectContaining({ mode: 'public' }), { approvedDatasources: CHANGED },
    );
  });

  it('warns about connections published without credentials', async () => {
    api.fetchPendingDatasources.mockResolvedValue([]);
    api.publishArtifact.mockResolvedValue({
      url: 'https://share/a1', accessMode: 'restricted',
      unapprovedDatasources: [{ label: 'mysql/late' }],
    });
    render(<ArtifactsView artifacts={[app]} />);
    openMenuItem('Share');
    shareFrom(screen.getByRole('dialog'));
    await waitFor(() => expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/mysql\/late/) }),
    ));
  });

  it('warns when a row Update published connections without credentials', async () => {
    api.updateArtifact.mockResolvedValue({ url: 'https://share/a1', unapprovedDatasources: [{ label: 'mysql/late' }] });
    render(<ArtifactsView artifacts={[{ ...app, publishedUrl: 'https://share/a1', modified: true }]} />);
    openMenuItem('Update');
    await waitFor(() => expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/mysql\/late/) }),
    ));
  });

  it('points a row Update that needs approval to Share', async () => {
    api.updateArtifact.mockRejectedValue(approvalError(PENDING));
    render(<ArtifactsView artifacts={[{ ...app, publishedUrl: 'https://share/a1', modified: true }]} />);
    openMenuItem('Update');
    await waitFor(() => expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Review them in Share/) }),
    ));
  });
});
