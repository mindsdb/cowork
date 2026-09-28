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
// Mutable so each test can pick the app it runs in.
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false, isElectron: false, openExternal: vi.fn() }));
vi.mock('../../platform/host', () => ({ host: hostMock }));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => ({ add: vi.fn() }) }));

import ArtifactsView from './ArtifactsView';

afterEach(() => {
  localStorage.clear();
  hostMock.isWeb = true;
});

// ENG-2169: a user who made artifacts in one app and opens the other saw a
// first-run empty state with no explanation, and read it as lost work.
describe('ArtifactsView empty state names where other artifacts are', () => {
  it('on web, points at the desktop app', () => {
    hostMock.isWeb = true;
    render(<ArtifactsView artifacts={[]} agentLabel="Anton" />);
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(screen.getByText(/Artifacts made in the desktop app stay there\./)).toBeInTheDocument();
  });

  it('on desktop, points at the web app', () => {
    hostMock.isWeb = false;
    render(<ArtifactsView artifacts={[]} agentLabel="Anton" />);
    expect(screen.getByText(/Artifacts made in the web app stay there\./)).toBeInTheDocument();
  });

  it('keeps the existing explanation of what appears here', () => {
    render(<ArtifactsView artifacts={[]} agentLabel="Anton" />);
    expect(screen.getByText(/When Anton creates documents, dashboards, or code outputs/)).toBeInTheDocument();
  });

  it('says nothing about the other app once there are artifacts', () => {
    hostMock.isWeb = false;
    render(<ArtifactsView artifacts={[{ id: 'a1', path: '/p/.anton/artifacts/x/report.md', title: 'Report', type: 'document', mtime: 1 }]} agentLabel="Anton" />);
    expect(screen.queryByText(/stay there/)).toBeNull();
  });
});
