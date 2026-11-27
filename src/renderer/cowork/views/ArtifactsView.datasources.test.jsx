import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setOrgMode(false);
});

// Share's own connection list lives in the viewer's Share menu
// (PublishMenu.datasources.test.jsx); the row's Update stays here.
describe('connection approval on the Artifacts page', () => {
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
