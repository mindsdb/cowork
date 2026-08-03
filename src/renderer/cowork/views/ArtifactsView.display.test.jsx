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

const fileArtifact = {
  id: 'a1', path: '/proj/.anton/artifacts/2026-forecast/MindsHub_2026_Forecast.xlsx',
  title: '2026 Forecast', type: 'document', updated: 'updated 2h ago', mtime: 1000,
};

const webAppArtifact = {
  id: 'a2', path: '/proj/.anton/artifacts/weather/index.html',
  title: 'Weather Dashboard', type: 'html-app', updated: 'updated 1h ago', mtime: 2000,
};

describe('ArtifactsView grid card display (ENG-1123 Bug 1)', () => {
  it('shows the title as the primary line and the filename as a secondary line', () => {
    render(<ArtifactsView artifacts={[fileArtifact]} />);
    expect(screen.getByText('2026 Forecast')).toBeInTheDocument();
    expect(screen.getByText('MindsHub_2026_Forecast')).toBeInTheDocument();
    expect(screen.getByText('.xlsx')).toBeInTheDocument();
  });

  it('renders no secondary line for a web-app artifact', () => {
    render(<ArtifactsView artifacts={[webAppArtifact]} />);
    expect(screen.getByText('Weather Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('index')).toBeNull();
    expect(screen.queryByText('.html')).toBeNull();
  });
});
